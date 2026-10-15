#!/usr/bin/env python3
"""
Turn the raw SoundDino Pikachu rips into game-ready cue files.

Three things were wrong with them as downloaded, and all three read to a player
as "the sound is weird" rather than as anything diagnosable:

  1. every clip opens with 0.1-0.5s of silence, so a cue fired late — the jump
     sound landed well after the jump,
  2. peak levels ranged from 0.16 to 0.60, so consecutive cues jumped in volume,
  3. they are 128kbps stereo, which is a silly way to ship a 0.4s chirp.

So: trim to the measured voice region, peak-normalise everything to -1 dBFS,
fade 12ms in / 30ms out (a hard cut on a waveform clicks), downmix to mono and
re-encode at 64kbps. Run from the project root.
"""
import json, os, re, subprocess, sys

SRC = '/tmp/sd'
OUT = 'public/audio'

# name            source file                                              start  end    note
CLIPS = [
    ('pika-hop',  'pikachu-baby.mp3',                                      0.07,  0.46, 'short "pika" — jumping'),
    ('pika-yay',  'pikachu-talking.mp3',                                   0.34,  1.06, 'bright "pika-chu" — a pickup'),
    ('pika-chu',  'pikachu.mp3',                                           0.32,  1.21, 'the classic rising "pi-ka-chuuu"'),
    ('pika-pika', 'sound-pikachu-pikachu.mp3',                             0.29,  1.24, '"pika pika" — chatter'),
    ('pika-zap',  'pikachu-is-on-the-attack.mp3',                          0.36,  1.86, 'attack cry — a hit'),
    ('pika-echo', 'pokmon-yells-quotpikachuquot-with-echo.mp3',            0.26,  1.52, 'big yell with echo — victory'),
    ('pika-joy',  'the-sound-of-a-joyful-pikachu-from-the-animated-series-quotpokemonquot.mp3',
                                                                           0.46,  1.64, 'delighted — an achievement'),
    ('pika-ask',  'pikachu-voice.mp3',                                     0.23,  1.16, 'questioning lilt — your turn'),
]

def run(args):
    return subprocess.run(args, capture_output=True, text=True)

def peak_db(path, ss, to):
    r = run(['ffmpeg', '-hide_banner', '-ss', str(ss), '-to', str(to), '-i', path,
             '-af', 'volumedetect', '-f', 'null', '-'])
    m = re.search(r'max_volume:\s*(-?[\d.]+) dB', r.stderr)
    return float(m.group(1)) if m else 0.0

os.makedirs(OUT, exist_ok=True)
made = []
for name, src, ss, to, note in CLIPS:
    p = os.path.join(SRC, src)
    if not os.path.exists(p):
        print(f'  MISSING {src}'); continue
    gain = -1.0 - peak_db(p, ss, to)            # bring the loudest sample to -1 dBFS
    dur = to - ss
    out = os.path.join(OUT, f'{name}.mp3')
    af = (f'afade=t=in:st=0:d=0.012,'
          f'afade=t=out:st={max(0.0, dur - 0.03):.3f}:d=0.03,'
          f'volume={gain:.2f}dB')
    r = run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
             '-ss', str(ss), '-to', str(to), '-i', p,
             '-af', af, '-ac', '1', '-ar', '44100', '-b:a', '64k', out])
    if r.returncode != 0:
        print(f'  FAILED {name}: {r.stderr[:120]}'); continue
    sz = os.path.getsize(out)
    print(f'  {name:10s} {dur:.2f}s  gain {gain:+5.1f}dB  {sz:6d} B   {note}')
    made.append(name)
print(f'\n{len(made)} cue files written to {OUT}')
