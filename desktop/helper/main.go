// softus-checkin-helper — counts keyboard and mouse use on Linux, for the
// Softus Checkin desktop app.
//
// Wayland (and only Wayland) stops desktop apps from seeing input outside their
// own windows. The kernel still sees every key press and click on every Linux
// desktop, Xorg or Wayland, GNOME, KDE or anything else — through evdev
// (/dev/input/event*), which only root can read. This helper runs as root,
// reads those devices, and hands the app nothing but numbers: per second, how
// many keys were pressed, how many clicks and scrolls, how far the pointer
// moved, and whether anything happened at all.
//
// Input that comes from a software device rather than real hardware — a
// remote-control tool, or a "mouse jiggler" program, which is how one works on
// Linux — is counted as usual and also reported as "virtual", so it can be
// told apart.
//
// It never records or passes on WHICH key was pressed, and it keeps nothing:
// the counts of one second are sent to whoever is connected and then dropped.
//
// The app reads the counts from a Unix socket:
//
//	/run/softus-checkin/helper.sock
//
// one JSON object per line, one line per second:
//
//	{"t":1731840000,"keys":3,"clicks":1,"scrolls":0,"distance":420,"virtual":0,"active":true,"keyboards":1,"pointers":1}
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const version = "1.0.0"

const (
	evKey = 0x01
	evRel = 0x02
	evAbs = 0x03

	relX         = 0x00
	relY         = 0x01
	relHWheel    = 0x06
	relWheel     = 0x08
	relWheelHi   = 0x0b
	relHWheelHi  = 0x0c
	absX         = 0x00
	absY         = 0x01
	absMtX       = 0x35
	absMtY       = 0x36
	keyA         = 30 // KEY_A
	btnMisc      = 0x100
	btnLeft      = 0x110
	btnExtra     = 0x114
	btnToolFing  = 0x145
	btnTouch     = 0x14a
	btnToolDTap  = 0x14d
	btnToolTTap  = 0x14e
	btnToolQTap  = 0x14f
	eventSize    = 24 // struct input_event on 64-bit Linux
	tapMaxMillis = 250
)

type kind int

const (
	keyboard kind = iota
	mouse
	touchpad
)

func (k kind) String() string {
	return [...]string{"keyboard", "mouse", "touchpad"}[k]
}

/* ------------------------------------------------------------------------ */
/* Counting                                                                  */
/* ------------------------------------------------------------------------ */

type counts struct {
	Keys     int `json:"keys"`
	Clicks   int `json:"clicks"`
	Scrolls  int `json:"scrolls"`
	Distance int `json:"distance"`
	// Input events in this second that came from software devices.
	Virtual int  `json:"virtual"`
	Active  bool `json:"active"`
}

type tally struct {
	sync.Mutex
	now       counts
	distance  float64
	lastInput time.Time
}

func (t *tally) add(virtual bool, fn func(c *counts)) {
	t.Lock()
	fn(&t.now)
	if virtual {
		t.now.Virtual++
	}
	t.now.Active = true
	t.lastInput = time.Now()
	t.Unlock()
}

func (t *tally) move(virtual bool, d float64) {
	if d <= 0 {
		return
	}
	t.Lock()
	t.distance += d
	if virtual {
		t.now.Virtual++
	}
	t.now.Active = true
	t.lastInput = time.Now()
	t.Unlock()
}

func (t *tally) take() counts {
	t.Lock()
	defer t.Unlock()
	out := t.now
	out.Distance = int(math.Round(t.distance))
	t.now = counts{}
	t.distance = 0
	return out
}

var total tally

/* ------------------------------------------------------------------------ */
/* Devices                                                                   */
/* ------------------------------------------------------------------------ */

// readBits parses a /sys capabilities bitmap ("120013 0 4" — words, most
// significant first) into a bit test.
func readBits(path string) func(bit int) bool {
	raw, err := os.ReadFile(path)
	if err != nil {
		return func(int) bool { return false }
	}
	words := strings.Fields(strings.TrimSpace(string(raw)))
	var values []uint64
	for i := len(words) - 1; i >= 0; i-- { // least significant word first
		v, _ := strconv.ParseUint(words[i], 16, 64)
		values = append(values, v)
	}
	wordBits := 64
	if unsafe.Sizeof(uintptr(0)) == 4 {
		wordBits = 32
	}
	return func(bit int) bool {
		w := bit / wordBits
		return w < len(values) && values[w]&(1<<uint(bit%wordBits)) != 0
	}
}

// classify decides what an input device is from its capabilities, or false
// for things that are not keyboards or pointers (power buttons, lid switches,
// audio jacks, webcams' snapshot buttons…).
func classify(event string) (kind, bool) {
	base := filepath.Join("/sys/class/input", event, "device", "capabilities")
	ev := readBits(filepath.Join(base, "ev"))
	key := readBits(filepath.Join(base, "key"))
	rel := readBits(filepath.Join(base, "rel"))
	abs := readBits(filepath.Join(base, "abs"))
	switch {
	case ev(evAbs) && (abs(absX) || abs(absMtX)) && key(btnToolFing) && key(btnTouch):
		return touchpad, true
	case ev(evRel) && rel(relX) && rel(relY) && key(btnLeft):
		return mouse, true
	case ev(evKey) && key(keyA) && key(keyA+1) && key(keyA+2): // A, S, D: a real keyboard
		return keyboard, true
	}
	return 0, false
}

type absInfo struct {
	Value, Minimum, Maximum, Fuzz, Flat, Resolution int32
}

// axisRange asks the kernel for a touchpad axis' range (EVIOCGABS).
func axisRange(fd uintptr, axis int) float64 {
	var info absInfo
	request := uintptr(0x80184540 + axis) // _IOR('E', 0x40 + axis, struct input_absinfo)
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, request, uintptr(unsafe.Pointer(&info))); errno != 0 {
		return 0
	}
	return float64(info.Maximum - info.Minimum)
}

type device struct {
	path    string
	kind    kind
	name    string
	virtual bool // made by software (uinput), not a piece of hardware
}

func isVirtual(event string) bool {
	real, err := filepath.EvalSymlinks(filepath.Join("/sys/class/input", event))
	return err == nil && strings.Contains(real, "/devices/virtual/")
}

var (
	openMu sync.Mutex
	open   = map[string]*device{}
)

func deviceName(event string) string {
	raw, err := os.ReadFile(filepath.Join("/sys/class/input", event, "device", "name"))
	if err != nil {
		return event
	}
	return strings.TrimSpace(string(raw))
}

func scanDevices(verbose bool) {
	paths, _ := filepath.Glob("/dev/input/event*")
	for _, path := range paths {
		openMu.Lock()
		_, already := open[path]
		openMu.Unlock()
		if already {
			continue
		}
		event := filepath.Base(path)
		k, ok := classify(event)
		if !ok {
			continue
		}
		file, err := os.Open(path)
		if err != nil {
			if verbose {
				fmt.Fprintf(os.Stderr, "cannot read %s: %v\n", path, err)
			}
			continue
		}
		d := &device{path: path, kind: k, name: deviceName(event), virtual: isVirtual(event)}
		openMu.Lock()
		open[path] = d
		openMu.Unlock()
		if verbose {
			fmt.Fprintf(os.Stderr, "reading %s (%s: %s, virtual=%v)\n", path, k, d.name, d.virtual)
		}
		go readDevice(d, file)
	}
}

func deviceCounts() (keyboards, pointers int) {
	openMu.Lock()
	defer openMu.Unlock()
	for _, d := range open {
		if d.kind == keyboard {
			keyboards++
		} else {
			pointers++
		}
	}
	return
}

// readDevice turns one device's events into counts until it goes away.
func readDevice(d *device, file *os.File) {
	defer func() {
		file.Close()
		openMu.Lock()
		delete(open, d.path)
		openMu.Unlock()
	}()

	var rangeX, rangeY float64
	if d.kind == touchpad {
		rangeX = math.Max(axisRange(file.Fd(), absX), axisRange(file.Fd(), absMtX))
		rangeY = math.Max(axisRange(file.Fd(), absY), axisRange(file.Fd(), absMtY))
	}
	processEvents(d, file, rangeX, rangeY, &total)
}

// processEvents turns a stream of input_event structs into counts on t. It is
// separate from the device so it can be fed recorded or made-up events.
func processEvents(d *device, input io.Reader, rangeX, rangeY float64, t *tally) {
	// Touchpad state: taps and two-finger scrolling are made into clicks and
	// scrolls by the desktop, after the kernel — so they are recognised here.
	var (
		lastX, lastY       float64 = -1, -1
		touchStart         time.Time
		touchTravel        float64
		touchButtonPressed bool
		fingers            int
		scrollTravel       float64
		relDX, relDY       float64
	)
	// A touchpad's units, as screen pixels across a 1920-wide screen.
	scale := 1.0
	if rangeX > 0 {
		scale = 1920 / rangeX
	}

	reader := bufio.NewReaderSize(input, eventSize*64)
	buf := make([]byte, eventSize)
	for {
		if _, err := ioReadFull(reader, buf); err != nil {
			return
		}
		// The kernel's own time of the event, not when it was read.
		at := time.Unix(int64(binary.LittleEndian.Uint64(buf[0:8])), int64(binary.LittleEndian.Uint64(buf[8:16]))*1000)
		typ := binary.LittleEndian.Uint16(buf[16:18])
		code := int(binary.LittleEndian.Uint16(buf[18:20]))
		value := int32(binary.LittleEndian.Uint32(buf[20:24]))

		switch typ {
		case evKey:
			switch {
			case d.kind == keyboard && code < btnMisc && value == 1: // a press, not a release or auto-repeat
				t.add(d.virtual, func(c *counts) { c.Keys++ })
			case code >= btnLeft && code <= btnExtra && value == 1:
				if d.kind == touchpad {
					touchButtonPressed = true
				}
				t.add(d.virtual, func(c *counts) { c.Clicks++ })
			case d.kind == touchpad && code == btnTouch:
				if value == 1 {
					touchStart = at
					touchTravel = 0
					touchButtonPressed = false
					lastX, lastY = -1, -1
				} else if value == 0 {
					// A short touch that hardly moved, with no physical click: a tap.
					short := at.Sub(touchStart) < tapMaxMillis*time.Millisecond
					still := rangeX == 0 || touchTravel < rangeX*0.03
					if short && still && !touchButtonPressed {
						t.add(d.virtual, func(c *counts) { c.Clicks++ })
					} else {
						t.add(d.virtual, func(c *counts) {})
					}
				}
			case d.kind == touchpad && code >= btnToolFing && code <= btnToolQTap:
				if value == 1 {
					switch code {
					case btnToolDTap:
						fingers = 2
					case btnToolTTap, btnToolQTap:
						fingers = 3
					default:
						fingers = 1
					}
				}
			}
		case evRel:
			switch code {
			case relX:
				relDX += float64(value)
			case relY:
				relDY += float64(value)
			case relWheel, relHWheel:
				t.add(d.virtual, func(c *counts) { c.Scrolls++ })
			case relWheelHi, relHWheelHi:
				// Reported alongside the plain wheel events; not counted twice.
			}
		case evAbs:
			if d.kind != touchpad {
				continue
			}
			v := float64(value)
			switch code {
			case absX, absMtX:
				if lastX >= 0 {
					delta := math.Abs(v - lastX)
					touchTravel += delta
					if fingers >= 2 {
						scrollTravel += delta
					} else {
						t.move(d.virtual, delta*scale)
					}
				}
				lastX = v
			case absY, absMtY:
				if lastY >= 0 {
					delta := math.Abs(v - lastY)
					touchTravel += delta
					if fingers >= 2 {
						scrollTravel += delta
					} else {
						t.move(d.virtual, delta*scale)
					}
				}
				lastY = v
			}
			// Two fingers moving: about one wheel step per 3% of the pad.
			if rangeY > 0 && scrollTravel >= rangeY*0.03 {
				steps := int(scrollTravel / (rangeY * 0.03))
				scrollTravel -= float64(steps) * rangeY * 0.03
				t.add(d.virtual, func(c *counts) { c.Scrolls += steps })
			}
		case 0: // EV_SYN: the end of one report
			if relDX != 0 || relDY != 0 {
				t.move(d.virtual, math.Hypot(relDX, relDY))
				relDX, relDY = 0, 0
			}
		}
	}
}

func ioReadFull(r *bufio.Reader, buf []byte) (int, error) {
	read := 0
	for read < len(buf) {
		n, err := r.Read(buf[read:])
		read += n
		if err != nil {
			return read, err
		}
	}
	return read, nil
}

/* ------------------------------------------------------------------------ */
/* Serving the counts                                                        */
/* ------------------------------------------------------------------------ */

type line struct {
	T int64 `json:"t"`
	counts
	Keyboards int `json:"keyboards"`
	Pointers  int `json:"pointers"`
}

type hub struct {
	sync.Mutex
	clients map[chan []byte]struct{}
}

func (h *hub) add() chan []byte {
	ch := make(chan []byte, 120)
	h.Lock()
	h.clients[ch] = struct{}{}
	h.Unlock()
	return ch
}

func (h *hub) remove(ch chan []byte) {
	h.Lock()
	delete(h.clients, ch)
	h.Unlock()
}

func (h *hub) send(msg []byte) {
	h.Lock()
	defer h.Unlock()
	for ch := range h.clients {
		select {
		case ch <- msg:
		default: // a client not reading: it misses this second
		}
	}
}

func serve(socketPath string, h *hub) error {
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o755); err != nil {
		return err
	}
	_ = os.Remove(socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return err
	}
	// Any user's app may read the numbers — they say how busy, never what.
	if err := os.Chmod(socketPath, 0o666); err != nil {
		return err
	}
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(conn net.Conn) {
				defer conn.Close()
				ch := h.add()
				defer h.remove(ch)
				keyboards, pointers := deviceCounts()
				hello, _ := json.Marshal(map[string]interface{}{
					"hello": "softus-checkin-helper", "version": version,
					"keyboards": keyboards, "pointers": pointers,
				})
				if _, err := conn.Write(append(hello, '\n')); err != nil {
					return
				}
				for msg := range ch {
					_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
					if _, err := conn.Write(msg); err != nil {
						return
					}
				}
			}(conn)
		}
	}()
	return nil
}

func main() {
	showVersion := flag.Bool("version", false, "print the version and exit")
	listDevices := flag.Bool("devices", false, "list the keyboards and pointers found, then exit")
	socketPath := flag.String("socket", "/run/softus-checkin/helper.sock", "where the app connects")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}
	if *listDevices {
		paths, _ := filepath.Glob("/dev/input/event*")
		sort.Strings(paths)
		for _, path := range paths {
			event := filepath.Base(path)
			if k, ok := classify(event); ok {
				source := "hardware"
				if isVirtual(event) {
					source = "software"
				}
				fmt.Printf("%-20s %-9s %-9s %s\n", path, k, source, deviceName(event))
			}
		}
		return
	}

	scanDevices(true)
	h := &hub{clients: map[chan []byte]struct{}{}}
	if err := serve(*socketPath, h); err != nil {
		fmt.Fprintf(os.Stderr, "cannot listen on %s: %v\n", *socketPath, err)
		os.Exit(1)
	}
	keyboards, pointers := deviceCounts()
	fmt.Fprintf(os.Stderr, "softus-checkin-helper %s: %d keyboard(s), %d pointer(s), listening on %s\n",
		version, keyboards, pointers, *socketPath)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	second := time.NewTicker(time.Second)
	rescan := time.NewTicker(3 * time.Second) // keyboards and mice plugged in later
	for {
		select {
		case <-stop:
			_ = os.Remove(*socketPath)
			return
		case <-rescan.C:
			scanDevices(false)
		case now := <-second.C:
			keyboards, pointers := deviceCounts()
			msg, _ := json.Marshal(line{T: now.Unix(), counts: total.take(), Keyboards: keyboards, Pointers: pointers})
			h.send(append(msg, '\n'))
		}
	}
}
