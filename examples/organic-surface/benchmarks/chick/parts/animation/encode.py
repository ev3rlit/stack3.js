"""Encode and decode-check a single seamless 24 fps studio loop."""
import json
from pathlib import Path
import subprocess
import sys

out=Path(__file__).resolve().parent
frames=Path(sys.argv[-1]).resolve()
for n in range(1,157):
    path=frames/f'{n:04d}.png'
    if not path.exists():raise FileNotFoundError(path)
video=out/'chick-showcase.mp4'
subprocess.run(['ffmpeg','-loglevel','error','-y','-framerate','24','-start_number','1',
    '-i',str(frames/'%04d.png'),'-frames:v','156','-an','-vf','scale=out_color_matrix=bt709',
    '-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-colorspace','bt709',
    '-color_primaries','bt709','-color_trc','bt709','-movflags','+faststart',str(video)],check=True)
probe=subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries',
    'stream=width,height,avg_frame_rate,nb_read_frames,duration','-of','json',str(video)])
stream=json.loads(probe)['streams'][0]
assert (stream['width'],stream['height'],stream['nb_read_frames'],stream['avg_frame_rate'])==(864,648,'156','24/1')
assert float(stream['duration'])==6.5
subprocess.run(['ffmpeg','-v','error','-y','-i',str(video),'-vf',
    'fps=12,scale=576:432:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop','0',str(out/'chick-showcase.gif')],check=True)
print(stream)
