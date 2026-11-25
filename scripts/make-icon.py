"""Render the repository's geometric knot mark without third-party imaging packages."""
import math, struct, zlib
from pathlib import Path
size=512
angle=math.radians(34); cosine=math.cos(angle); sine=math.sin(angle)
rows=[]
for y in range(size):
 row=bytearray([0])
 for x in range(size):
  channels=[0.,0.,0.,0.]
  for dx,dy in [(0.25,0.25),(0.75,0.25),(0.25,0.75),(0.75,0.75)]:
   px=x+dx;py=y+dy
   inside=16<=px<=496 and 16<=py<=496 and math.hypot(max(abs(px-256)-128,0),max(abs(py-256)-128,0))<=112
   if not inside:continue
   ux=cosine*(px-256)+sine*(py-256)+256;uy=-sine*(px-256)+cosine*(py-256)+256
   mark=False
   for cx in [222,290]:
    distance=math.hypot(ux-cx,max(abs(uy-256)-62,0))
    mark=mark or 54<=distance<=74
   rgb=236 if mark else 33
   for k in range(3):channels[k]+=rgb/4
   channels[3]+=255/4
  # Keep RGB unpremultiplied at rounded-square edges.
  alpha=channels[3]
  if alpha and alpha<255:
   for k in range(3):channels[k]*=255/alpha
  row.extend(round(v) for v in channels)
 rows.append(row)
def chunk(tag,data):return struct.pack('!I',len(data))+tag+data+struct.pack('!I',zlib.crc32(tag+data)&0xffffffff)
content=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),9))+chunk(b'IEND',b'')
Path('packages/desktop/resources/icon.png').write_bytes(content)
