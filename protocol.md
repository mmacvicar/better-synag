# Aquarium Light TCP Protocol (work-in-progress)

This document summarizes what is currently known from private packet captures collected during reverse-engineering.
Raw `.pcapng` files are intentionally not committed to this repository.

## Transport
- TCP over port `80`.
- Main control traffic is binary custom protocol.

## Frame families

### 1) Control family (`dd ee ff`)
General frame:
- Byte `0..2`: magic `dd ee ff`
- Byte `3`: reserved (seen `00`)
- Byte `4`: length (`LEN`) for bytes `5..end` including checksum
- Byte `5`: target/route (seen `ff`)
- Byte `6..16`: 11-byte ASCII device id (example: `R5S2A000188`)
- Byte `17`: constant (seen `01`)
- Byte `18`: command group
- Byte `19`: command id
- Byte `20..N-2`: arguments
- Byte `N-1`: checksum

Checksum rule (confirmed):
- `checksum = sum(bytes[4..N-2]) & 0xff`

Request/response group relation often observed:
- response group seems to be request group + `0x50`
  - `0x0f -> 0x5f`
  - `0x04 -> 0x54`
  - `0x05 -> 0x55`

### 2) Keepalive/short-status family (`ff ee dd cc`)
Short 9-byte frames, e.g.:
- `ffeeddcc0000000000`
- `ffeeddcc0300010102`

Interpretation:
- likely heartbeat or compact status signaling.
- internal field semantics still unknown.

## Confirmed command map

### Startup/vendor handshake
- `0x01/0x04` = `query_vendor_tag`
- `0x51/0x04` = `report_vendor_tag`
  - args format: `[len][ascii vendor tag][optional trailing]`
  - observed: `08 6d61787370656374` -> `maxspect`

### Mode
- `0x0f/0x01` = `query_mode`
- `0x5f/0x01` = `report_mode`
  - arg `01` -> manual
  - arg `02` -> auto

### Set mode
- `0x0f/0x02` = `set_mode`
  - arg `01` -> manual
  - arg `02` -> auto
- `0x5f/0x02` = `ack_mode`

### Intensity (manual)
- `0x0f/0x0b` = `set_preview_intensity` (provisional name)
- `0x5f/0x0b` = `ack_preview_intensity`
  - 4-byte args use the same channel order as intensity/program values
  - observed during program point edits; appears to immediately apply a temporary preview state on the lamp
  - does not by itself persist schedule changes
- `0x0f/0x0c` = `set_intensity` with 4-byte args `[ch1,ch2,ch3,ch4]`
- `0x5f/0x0c` = `ack_intensity`
- channel values are percentage `0..100` (`0x00..0x64`)

Channel order (confirmed from ordered channel intensity traces):
1. `6500K_CoolWhite+455nm_DeepBlue`
2. `460nm_DeepBlue+480nm_Blue`
3. `400-420nm_Violet+445nm_DeepBlue`
4. `3000K_WarmWhite+665nm_DeepRed`

### Read intensity
- `0x0f/0x0d` = `query_intensity`
- `0x5f/0x0d` = `report_intensity` with 4-byte args `[ch1,ch2,ch3,ch4]`

### Program/schedule (auto)
- `0x0f/0x0e` = `set_program`
- `0x5f/0x0e` = `ack_set_program`
  - observed ack args: `01` (likely success)
- `0x0f/0x0f` = `query_program`
- `0x5f/0x0f` = `report_program`

`set_program` and `report_program` args format (confirmed):
- Byte 0: point count `N`
- Then `N` records of 7 bytes each:
  - `index` (1..N)
  - `hour`
  - `minute`
  - `ch1`
  - `ch2`
  - `ch3`
  - `ch4`

In auto-open traces, decoded points match app values exactly.
In program-upload traces, the `set_program` payload uses the same point layout and matches the uploaded schedule.
In program-edit traces, app sends `set_preview_intensity (0x0f/0x0b)` while editing points, and only persists edits when `set_program (0x0f/0x0e)` is transmitted.

### Device info
- `0x04/0x01` = `query_device_info`
- `0x54/0x01` = `report_device_info`

Current best decode for `report_device_info` args:
- bytes `0..1`: device number (big-endian)
  - e.g. `0x00bc` -> 188
- bytes `2..12`: 11-byte ASCII device id
  - e.g. `R5S2A000188`
- bytes `13..15`: version triplet (raw semantic still uncertain)
  - e.g. `02 01 01` for RSX300 light
  - decoder exposes this as `version_triplet_raw`
  - `software_version_guess` currently uses first two values (e.g. `2.1`)
- bytes `16..17`: flags/reserved (seen `0000`)
- remaining bytes: likely name/metadata, null-padded

Notes:
- This part is still partially uncertain and should be validated with more examples.
- App-reported versions are split into `HW` and `SW`, and do not map 1:1 yet to the raw triplet.
- Example app values observed:
  - RSX300 (`R5S2A...`): HW `1.0`, SW `2.1`
  - Gyre (`G2C2A...`): HW `1.1`, SW `2.2`

## Other observed groups
- `0x05/0x01` = `query_runtime_status` (name provisional)
- `0x55/0x01` = `report_runtime_status` (name provisional)
  - observed request args are 7 bytes where last 5 bytes remained constant across app-open captures and first 2 bytes changed:
    - `2f200c0f07021a`
    - `29210c0f07021a`
  - likely contains volatile/session/time component in first 2 bytes.
  - response currently observed as 1-byte `01`.

## Device identity in mixed setups
- Device targeting is explicit in control frame bytes `6..16` (11-byte ASCII device id).
- RSX300 light commands in traces target `R5S2A000188` on wire.
- Another device id reported in app context is `G2C2A000180` (Gyre system).
- App UI may render IDs slightly differently from on-wire bytes in some cases (example: displayed `R5S2A0000188` vs observed wire id `R5S2A000188`).

## App open flows

### Open while manual
Observed sequence:
1. `query_mode` -> `report_mode(manual)`
2. `query_intensity` -> `report_intensity(ch1..ch4)`

### Open while auto
Observed sequence:
1. `query_mode` -> `report_mode(auto)`
2. `query_program` -> `report_program(points...)`
3. Additional metadata traffic (`0x04/0x01`, `0x54/0x01`, and `0x05/0x01`/`0x55/0x01`)

## Unknowns / next captures needed
- Program write command (upload modified schedule)
- "Simulate day" command behavior
- Precise structure of `0x54/0x01` trailing metadata/name fields
- Meaning of keepalive family `ff ee dd cc` fields
- Meaning of `0x05/0x01` and `0x55/0x01`
