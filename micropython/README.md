# The Mind-Controlled Microcontroller, in MicroPython

The Mind-Controlled Microcontroller as a MicroPython program, on the
`intomind` library for MicroPython. It does what the program in C in
`pico/board/` does, in one file you can open and change in Thonny. The
board connects to your IntoMind One by itself and turns its LED on while
your custom AI head reads On. Teach the head and install it on the
Mind-Controlled Light Switch demo first.

## Putting it on a board

1. Put the IntoMind MicroPython firmware on a Raspberry Pi Pico 2 W. It is
   `firmware/intomind-micropython-pico-2-w.uf2` in the intomind/micropython
   repository. Hold the white BOOTSEL button while you plug the board into
   your computer, then let go, and drag the file onto the drive that
   appears.
2. Open Thonny and choose MicroPython (Raspberry Pi Pico) at the bottom
   right.
3. Open `mind_controlled_microcontroller.py`, then save it to the board as
   `main.py`: File, Save as, Raspberry Pi Pico.
4. Press Ctrl-D in Thonny's shell. The board restarts and runs it, and from
   then on it runs whenever the board has power. What it is doing prints in
   the shell.

Then take your IntoMind One off its charger and put it on. The first time,
the board pairs with it, and from then on it remembers it.

## What the LED says

| | |
|---|---|
| One short blink a second | looking for your IntoMind One |
| Two short blinks a second | your IntoMind One is on its charger, and sends no EEG until it is off it |
| Three short blinks a second | no custom AI head is installed on your IntoMind One yet |
| Off | your custom AI head reads Off |
| On | your custom AI head reads On |
| Fast blinking | the last reading had a gap in the signal, or an electrode had lost the skin |

## Changing it

The file has two functions that are yours:

- `on_switch(on)` runs whenever the decision changes, and with `False`
  when the link to your IntoMind One is lost.
- `on_reading(score, clean)` runs for every reading, every few seconds,
  with your custom AI head's score, near 0 for Off and near 1 for On, and
  whether the signal was clean.

The code to drive a pin is already there, commented out: GP15, the board's
pin 20, with ground on pin 18. Uncomment the two lines and the pin goes to
3.3 volts while your custom AI head reads On, a signal any circuit, robot
or project of your own can act on. Three settings sit at the top: the head
slot, the threshold, and the start of your IntoMind One's name, to choose
one among several.

Everything else a board can do with an IntoMind One, from the EEG itself
to the battery, is in the `intomind` library. Its README, in the
intomind/micropython repository, lists it.
