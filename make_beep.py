import struct, math, base64
sr = 8000
def tone(freq, dur, start=0.0):
    n = int(sr * dur)
    return bytes(int(16000 * math.sin(2 * math.pi * freq * (start + i / sr))) & 0xFF for i in range(n))
data = tone(880, 0.10, 0.0) + b'\x00' * int(sr * 0.05) + tone(1100, 0.12, 0.0)
nd = len(data)
hdr = (b'RIFF' + struct.pack('<I', 36 + nd) + b'WAVEfmt '
       + struct.pack('<IHHIIHH', 16, 1, 1, sr, sr, 1, 16)
       + b'data' + struct.pack('<I', nd) + data)
b64 = base64.b64encode(hdr).decode()
open('/tmp/beep_b64.txt', 'w').write(b64)
print('len chars:', len(b64))
print(b64[:100])
