# IntoMind Demo Suite

Five things to do with an IntoMind One from a web page, with nothing to
install, and one with a Raspberry Pi Pico 2 W, built on the published
`@intomind/sdk` and `intomind` packages. The demos also run as Python
scripts and as Rust programs, for people who work in those, and the
Mind-Controlled Microcontroller as a MicroPython program. The site is at
demo.intomind.com.

| | |
|---|---|
| Alpha Flower | Close your eyes and a flower grows from the signal itself. Open them and it stays. Four forms, one color read from your alpha peak, saved as an image. |
| BCI Flight Simulator | Four lights flicker at exact rates. Look at one and the ship turns toward it, read from the raw signal in the browser. |
| Age Detector | The open source AI head for age runs on the IntoMind One's own chip and says how old your brain looks, with the published error either side. |
| Biological Sex Detector | The open source AI head for biological sex lands a score between male and female, the two groups drawn from its published AUC. |
| Mind-Controlled Light Switch | Teach a custom AI head two states in your browser and install it on your IntoMind One, which runs it on its own chip, and the Pico 2 W drawn on the demo lights its LED while it reads On. |
| Mind-Controlled Microcontroller | One file on a Raspberry Pi Pico 2 W, and the board connects to your IntoMind One by itself and turns its LED on while your custom AI head reads On, with no computer in the room. |

```
python3 -m http.server 8000      # then open http://localhost:8000/
```

Every demo needs an IntoMind One and a browser with Web Bluetooth: Chrome
or Edge on a computer, Chrome on Android. Add `?dev` to a demo's address to
run it on a simulated IntoMind One, for working on the demo with no device
in the room. Keys while it runs: c closed, f focus, j jaw, arrows look.

| | |
|---|---|
| `index.html`, `main.js` | the home page |
| `alpha-flower/`, `flight-simulator/`, `age-detector/`, `biological-sex-detector/`, `light-switch/` | the five demos |
| `pico/` | the Mind-Controlled Microcontroller: the guide, the program file ready for a Raspberry Pi Pico 2 W, and in `pico/board/` its source in C with its build steps and licenses |
| `lib/` | what the demos share: the IntoMind One through the SDK, the shell, the flower, the ship, the Pico 2 W board, the readouts, the flicker decoder, the trainer, the game, the published numbers, the simulated IntoMind One |
| `vendor/` | the published SDK and the two open source AI heads, byte for byte, with checksums |
| `python/` | the demos as scripts, on the published `intomind` package |
| `rust/` | the demos as Rust programs, on the published `intomind` crate |
| `micropython/` | the Mind-Controlled Microcontroller as a MicroPython program, on the `intomind` library for MicroPython |
| `assets/` | the stylesheet, and Geist and Geist Mono under the SIL Open Font License, with Geist's barred capital I made its default so that an I never reads as a lowercase l |
| `tests/` | Node and Python tests for the library and the MicroPython program, and `shoot.mjs`, which photographs every page in headless Chrome and reports exceptions |
| `check.py` | the gate: checksums, the board file, every quoted figure against its source, no external loads, the house style, the tests |

Free software under the GNU Affero General Public License, version 3. See
`LICENSING.md`, and `pico/board/README.md` for the Pico 2 W program and the
libraries inside its file. IntoMind is a trademark of IntoMind, Inc.
