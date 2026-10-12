"""Record a phone-sized demo video with Playwright (real mic path, fake audio file)."""
import os, sys, subprocess, time, socket, glob, shutil
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WAV = sys.argv[1]; OUT = sys.argv[2]; PORT = 8766
vid_dir = '/tmp/jarvis-vid'; shutil.rmtree(vid_dir, ignore_errors=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
TAP_JS = """(sel) => { const r = document.querySelector(sel).getBoundingClientRect();
  const d = document.createElement('div'); d.style.cssText = `position:fixed;z-index:99;left:${r.left+r.width/2-28}px;top:${r.top+r.height/2-28}px;width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.45);border:2px solid #fff;pointer-events:none;transition:all .5s`;
  document.body.appendChild(d); setTimeout(()=>{d.style.opacity=0;d.style.transform='scale(1.8)'},250); setTimeout(()=>d.remove(),900); }"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                                    '--use-file-for-fake-audio-capture=' + WAV + '%noloop'])
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, permissions=['microphone'],
                            record_video_dir=vid_dir, record_video_size={'width': 390, 'height': 844})
        pg = ctx.new_page()
        def tap(sel):
            pg.evaluate(TAP_JS, sel); pg.wait_for_timeout(350); pg.click(sel)
        pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_timeout(2200)
        tap('#startBtn')
        pg.wait_for_selector('#hud:not([hidden])', timeout=20000)   # double clap at ~4 s into the audio
        pg.wait_for_timeout(5500)
        tap('#hudClose'); pg.wait_for_timeout(1200)
        pg.evaluate("document.getElementById('launchView').scrollIntoView()"); pg.wait_for_timeout(2000)
        tap('#settingsPanel > summary'); pg.wait_for_timeout(1800)
        tap('#editPanel > summary'); pg.wait_for_timeout(500)
        pg.evaluate("document.getElementById('editPanel').scrollIntoView()"); pg.wait_for_timeout(2200)
        tap('#shortcutPanel > summary'); pg.wait_for_timeout(500)
        pg.evaluate("document.getElementById('shortcutPanel').scrollIntoView()"); pg.wait_for_timeout(3500)
        pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(2000)
        ctx.close(); b.close()
finally:
    srv.terminate()
webm = glob.glob(vid_dir + '/*.webm')[0]
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium',
                '-crf', '23', '-movflags', '+faststart', OUT], check=True)
print('wrote', OUT)
