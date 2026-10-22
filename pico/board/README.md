# The Mind-Controlled Light Switch on a Raspberry Pi Pico 2 W

`main.c` is the whole program. The board finds an IntoMind One over
Bluetooth, pairs with it once and remembers it, asks it to run the custom
AI head installed from the Mind-Controlled Light Switch demo, and turns its
LED on while the custom AI head reads On. The guide for putting it on a
board is the page beside this folder, `pico/index.html`.

## What the LED says

| | |
|---|---|
| One short blink a second | looking for your IntoMind One |
| Two short blinks a second | your IntoMind One is on its charger, and sends no EEG until it is off it |
| Three short blinks a second | no custom AI head is installed on your IntoMind One yet |
| Off | your custom AI head reads Off |
| On | your custom AI head reads On |
| Fast blinking | the last reading had a gap in the signal, or an electrode had lost the skin |

## Settings

Four lines near the top of `main.c`:

- `HEAD_SLOT` is where the Mind-Controlled Light Switch demo installs your custom AI head, slot 2.
- `SWITCH_THRESHOLD` is the reading above which the switch is On, 0.5, the same line the demo draws.
- `SWITCH_PIN` is the pin the commented-out code below drives, GP15.
- `DEVICE_NAME_PREFIX` chooses one IntoMind One among several by the start of its name, like `"Ada's"`. Empty takes the first one found.

## Your code goes here

Three functions near the top are yours:

- `on_start()` runs once when the board starts. Set up whatever you will switch.
- `on_switch(bool on)` runs whenever the decision changes. It is false when the link to your IntoMind One is lost, so whatever you switch turns off with it.
- `on_reading(float score, bool clean)` runs for every reading, every few seconds, with the custom AI head's score from 0 to 1, for anything finer than on and off.

The code to drive a pin is already in them, commented out. Uncomment the
three lines in `on_start()` and the one in `on_switch()`, rebuild, and pin
GP15, the board's pin 20, goes high while your custom AI head reads On.
Ground is pin 18, two pins along. The pin goes to 3.3 volts, a signal any
circuit, robot or project of your own can act on.

## Building it

You need CMake, the Arm compiler `arm-none-eabi-gcc`, a compiler for your
own computer, and Raspberry Pi's toolkit for the board, the Pico SDK.

```
git clone --branch 2.3.1 https://github.com/raspberrypi/pico-sdk.git
git -C pico-sdk submodule update --init lib/btstack lib/cyw43-driver lib/tinyusb
export SOURCE_DATE_EPOCH=$(git -C pico-sdk log -1 --format=%ct)
cmake -S pico/board -B build -DPICO_SDK_PATH="$PWD/pico-sdk"
cmake --build build
```

`SOURCE_DATE_EPOCH` stamps the Pico SDK release's date as the build date,
so the file carries no date from the machine that built it. The file to put
on the board is `build/light-switch-pico-2-w.uf2`. The one the guide hands
out, `pico/light-switch-pico-2-w.uf2`, was built this way from this source
with Pico SDK 2.3.1, and `pico/SHA256SUMS` holds its checksum.

While the board is plugged into a computer it prints what it is doing over
USB, and any serial monitor shows it.

## Licenses

The program is free software under the GNU Affero General Public License,
version 3, with one added permission: it may be combined with the Raspberry
Pi Pico SDK, BTstack, and the cyw43 driver and its firmware, under their own
licenses. The file `light-switch-pico-2-w.uf2` contains those, and their
licenses are in `licenses/`:

| | |
|---|---|
| `pico-sdk.txt` | the Raspberry Pi Pico SDK |
| `btstack.txt`, `btstack-raspberry-pi.txt` | BTstack, the Bluetooth library, used under Raspberry Pi's license for the Pico 2 W |
| `cyw43-driver.txt`, `cyw43-driver-raspberry-pi.txt` | the driver and firmware for the wireless chip, used under Raspberry Pi's license for its chips |
| `tinyusb.txt` | TinyUSB, for the messages over USB |
| `micro-ecc.txt` | micro-ecc, the elliptic curve code for secure pairing |

The AES code inside BTstack, by Philip J. Erdelsky, is in the public domain.
