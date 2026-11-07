# Gujarati speech samples

A static page (no build step) for listening to real Gujarati recordings next to synthesized versions of the same sentences, with each clip measured against the real recording.

* 15 held-out sentences: 5 female, 5 male, 5 for a control-request test (pitch, loudness, speed requests).
* Systems: real recording; untouched IndicF5; IndicF5 + LoRA; + control adapter; + reliability-masked controls; MMS-TTS-guj.
* Measures per clip (after time-aligning it to the real recording): pitch-contour correlation, loudness-contour correlation, MFCC distance, length ratio, speaker-embedding cosine, character error rate of a Gujarati recognizer.
* Sentences were chosen by a seeded shuffle, not by listening or by metric. These are similarity measures against one real reading, not quality scores. No listening test was run.

Open `index.html` through a web server (for example `python3 -m http.server`); opening the file directly blocks loading `data/samples.json`.

## Credits and licences

* Real recordings: IISc SPICOR project Gujarati corpus (SYSPIN / SPIRE Lab, IISc). The SYSPIN corpus is published under CC BY 4.0; check the terms of the Gujarati subset before reusing these clips. If you are a rights holder and want a clip removed, open an issue.
* IndicF5: AI4Bharat, MIT licence, built on F5-TTS.
* MMS-TTS-guj: Meta, CC BY-NC 4.0, so this page is for non-commercial research use.
