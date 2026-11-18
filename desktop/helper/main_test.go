package main

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// events builds the bytes the kernel would hand over: struct input_event on
// 64-bit Linux, with the time of each event.
type events struct {
	buf bytes.Buffer
	at  time.Time
}

func newEvents() *events { return &events{at: time.Unix(1_700_000_000, 0)} }

func (e *events) after(d time.Duration) *events { e.at = e.at.Add(d); return e }

func (e *events) add(typ, code int, value int32) *events {
	raw := make([]byte, eventSize)
	binary.LittleEndian.PutUint64(raw[0:8], uint64(e.at.Unix()))
	binary.LittleEndian.PutUint64(raw[8:16], uint64(e.at.Nanosecond()/1000))
	binary.LittleEndian.PutUint16(raw[16:18], uint16(typ))
	binary.LittleEndian.PutUint16(raw[18:20], uint16(code))
	binary.LittleEndian.PutUint32(raw[20:24], uint32(value))
	e.buf.Write(raw)
	return e
}

func (e *events) syn() *events { return e.add(0, 0, 0) }

func run(t *testing.T, d *device, e *events, rangeX, rangeY float64) counts {
	t.Helper()
	var tl tally
	processEvents(d, bytes.NewReader(e.buf.Bytes()), rangeX, rangeY, &tl)
	return tl.take()
}

func TestKeyboardCountsPressesNotRepeatsOrReleases(t *testing.T) {
	e := newEvents()
	for _, key := range []int{30, 31, 32} { // A S D
		e.add(evKey, key, 1).syn().after(50*time.Millisecond).add(evKey, key, 0).syn()
	}
	// Holding a key: one press, then auto-repeats (value 2), then the release.
	e.add(evKey, 57, 1).syn()
	for i := 0; i < 20; i++ {
		e.after(30*time.Millisecond).add(evKey, 57, 2).syn()
	}
	e.add(evKey, 57, 0).syn()
	got := run(t, &device{kind: keyboard}, e, 0, 0)
	if got.Keys != 4 || got.Clicks != 0 || !got.Active || got.Virtual != 0 {
		t.Fatalf("want 4 keys, no clicks, active; got %+v", got)
	}
}

func TestMouseClicksScrollsAndDistance(t *testing.T) {
	e := newEvents()
	e.add(evRel, relX, 30).add(evRel, relY, 40).syn() // 50 px
	e.add(evRel, relX, -3).add(evRel, relY, 4).syn()  // 5 px
	e.add(evKey, btnLeft, 1).syn().add(evKey, btnLeft, 0).syn()
	e.add(evKey, btnLeft+1, 1).syn().add(evKey, btnLeft+1, 0).syn() // right button
	e.add(evRel, relWheel, -1).add(evRel, relWheelHi, -120).syn()   // one notch, reported twice
	e.add(evRel, relWheel, -1).add(evRel, relWheelHi, -120).syn()
	got := run(t, &device{kind: mouse}, e, 0, 0)
	if got.Clicks != 2 || got.Scrolls != 2 || got.Distance != 55 || got.Keys != 0 {
		t.Fatalf("want 2 clicks, 2 scrolls, 55 px; got %+v", got)
	}
}

func TestMouseButtonsOnAKeyboardDeviceAreNotKeys(t *testing.T) {
	// Some keyboards expose mouse buttons; they are clicks, not key presses.
	e := newEvents().add(evKey, btnLeft, 1).syn().add(evKey, btnLeft, 0).syn()
	got := run(t, &device{kind: keyboard}, e, 0, 0)
	if got.Keys != 0 || got.Clicks != 1 {
		t.Fatalf("want 1 click, 0 keys; got %+v", got)
	}
}

// A touchpad 1000 units wide and 600 high.
const padX, padY = 1000, 600

func touch(e *events, x, y int32) *events {
	return e.add(evKey, btnTouch, 1).add(evKey, btnToolFing, 1).add(evAbs, absX, x).add(evAbs, absY, y).syn()
}

func TestTouchpadTapIsAClick(t *testing.T) {
	e := newEvents()
	touch(e, 500, 300)
	e.after(80*time.Millisecond).add(evAbs, absX, 502).syn() // hardly moves
	e.after(40*time.Millisecond).add(evKey, btnTouch, 0).add(evKey, btnToolFing, 0).syn()
	got := run(t, &device{kind: touchpad}, e, padX, padY)
	if got.Clicks != 1 {
		t.Fatalf("a quick, still touch should be a tap-click; got %+v", got)
	}
}

func TestTouchpadSlowOrMovingTouchIsNotATap(t *testing.T) {
	// Resting a finger (long) and moving the pointer (far) are not clicks.
	long := newEvents()
	touch(long, 500, 300)
	long.after(600*time.Millisecond).add(evKey, btnTouch, 0).syn()
	if got := run(t, &device{kind: touchpad}, long, padX, padY); got.Clicks != 0 || !got.Active {
		t.Fatalf("a long touch is not a tap but is activity; got %+v", got)
	}

	moving := newEvents()
	touch(moving, 100, 300)
	for x := int32(120); x <= 400; x += 20 {
		moving.after(5*time.Millisecond).add(evAbs, absX, x).syn()
	}
	moving.add(evKey, btnTouch, 0).syn()
	got := run(t, &device{kind: touchpad}, moving, padX, padY)
	if got.Clicks != 0 || got.Distance < 500 {
		t.Fatalf("moving the pointer: no click, distance in screen pixels; got %+v", got)
	}
}

func TestTouchpadPhysicalClickCountsOnce(t *testing.T) {
	// Pressing a clickpad down: the button event counts; the touch is not also a tap.
	e := newEvents()
	touch(e, 500, 300)
	e.after(30*time.Millisecond).add(evKey, btnLeft, 1).syn()
	e.after(30*time.Millisecond).add(evKey, btnLeft, 0).syn()
	e.after(30*time.Millisecond).add(evKey, btnTouch, 0).syn()
	if got := run(t, &device{kind: touchpad}, e, padX, padY); got.Clicks != 1 {
		t.Fatalf("want exactly 1 click; got %+v", got)
	}
}

func TestTouchpadTwoFingerScroll(t *testing.T) {
	e := newEvents()
	e.add(evKey, btnTouch, 1).add(evKey, btnToolDTap, 1).add(evAbs, absX, 500).add(evAbs, absY, 100).syn()
	for y := int32(110); y <= 400; y += 10 { // 300 units = half the pad
		e.after(10*time.Millisecond).add(evAbs, absY, y).syn()
	}
	e.add(evKey, btnTouch, 0).add(evKey, btnToolDTap, 0).syn()
	got := run(t, &device{kind: touchpad}, e, padX, padY)
	// One wheel step per 3% of the pad's height: 300 / 18 ≈ 16.
	if got.Scrolls < 14 || got.Scrolls > 18 {
		t.Fatalf("want about 16 scroll steps; got %+v", got)
	}
	if got.Distance != 0 {
		t.Fatalf("two-finger scrolling should not move the pointer; got %+v", got)
	}
}

func TestSoftwareDeviceInputIsMarkedVirtual(t *testing.T) {
	// What a mouse-jiggler program does: tiny moves, every few seconds.
	e := newEvents()
	for i := 0; i < 5; i++ {
		e.after(2*time.Second).add(evRel, relX, 1).syn().add(evRel, relX, -1).syn()
	}
	got := run(t, &device{kind: mouse, virtual: true}, e, 0, 0)
	if got.Virtual == 0 || got.Distance == 0 || got.Clicks != 0 || got.Keys != 0 {
		t.Fatalf("software input should be counted and marked virtual; got %+v", got)
	}
	hardware := run(t, &device{kind: mouse}, newEvents().add(evRel, relX, 5).syn(), 0, 0)
	if hardware.Virtual != 0 {
		t.Fatalf("hardware input must not be marked virtual; got %+v", hardware)
	}
}

func TestReadBitsParsesSysfsBitmaps(t *testing.T) {
	// The kernel prints capability words most significant first:
	// "120013 0 0 4" is word 3 = 0x120013 (bits 0, 1, 4, 17, 20) … word 0 = 0x4 (bit 2).
	path := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(path, []byte("120013 0 0 4\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	bits := readBits(path)
	if !bits(2) || bits(3) || bits(64) {
		t.Fatalf("least significant word read wrongly")
	}
	for _, bit := range []int{0, 1, 4, 17, 20} {
		if !bits(192 + bit) {
			t.Fatalf("bit %d of the most significant word should be set", bit)
		}
	}
	if bits(192+2) || bits(256) {
		t.Fatalf("unset bits read as set")
	}
}
