"""Generate a synthetic double-clap WAV: two fast-decaying noise bursts 300 ms apart over light noise."""
import math, random, struct, wave, sys
out = sys.argv[1] if len(sys.argv) > 1 else 'test/double-clap.wav'
sr, dur = 48000, 3.0
random.seed(42)
n = int(sr * dur)
claps = [1.2, 1.5]
samples = []
for i in range(n):
    t = i / sr
    s = random.gauss(0, 0.004)
    for c in claps:
        if t >= c:
            dt = t - c
            if dt < 0.12:
                s += random.uniform(-1, 1) * 0.85 * math.exp(-dt / 0.008)
    samples.append(max(-1.0, min(1.0, s)))
with wave.open(out, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(b''.join(struct.pack('<h', int(x * 32767)) for x in samples))
print('wrote', out)
