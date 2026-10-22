# Contributing

Issues, questions, and pull requests are welcome.

## Before your first pull request

Sign the contributor license agreement. It is short, it is in `CLA.md`,
and it is signed once rather than per contribution. Comment on your pull
request with:

```
I have read CLA.md and I agree to it.
```

from the account that owns the contribution. A maintainer records the
agreement against your account and later pull requests need nothing
further.

You keep the copyright in your work. The agreement gives IntoMind the
right to use your contribution under both the Affero license and the
commercial license, which is what makes it possible to offer either one.

## What makes a change easy to accept

- One change per pull request, with the reason in the message.
- `python3 check.py` passes.
- A change to a demo was run on a device.
- The house style: American English, plain sentences, no em dashes, no
  abbreviation a reader has to look up, no number without its source.
- Nothing loaded from another site, and no build step for the pages. A
  page is HTML and modules a browser runs as they are. Two things are
  built: the Rust programs, which cargo builds, and the Pico 2 W program,
  with the steps in `pico/board/README.md`. A change to the Pico 2 W
  program comes with the rebuilt file and its checksum.

## What gets refused

- A claim a page cannot back: a number not in `lib/numbers.js` with its
  source, a word like medical or clinical, a simulation standing in for a
  connection.
- Anything that records or sends a person's data without their asking for
  it.
- A dependency added for something small.

## Security

Report anything security sensitive to contact@intomind.com rather than in
a public issue.
