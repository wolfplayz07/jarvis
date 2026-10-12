"""Longer WAV for the demo video: room noise with soft murmurs, one double clap at 4.0 s."""
import math, random, struct, wave, sys
out = sys.argv[1]
sr, dur = 48000, 40.0
random.seed(7)
n = int(sr * dur); data = bytearray()
for i in range(n):
    t = i / sr
    s = random.gauss(0, 0.006)
    s += random.gauss(0, 0.03) * max(0.0, math.sin(2 * math.pi * 0.7 * t)) ** 6  # soft murmur
    for c in (4.0, 4.32):
        if c <= t < c + 0.12:
            s += random.uniform(-1, 1) * 0.85 * math.exp(-(t - c) / 0.008)
    data += struct.pack('<h', int(max(-1, min(1, s)) * 32767))
with wave.open(out, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(bytes(data))
