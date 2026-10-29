"""Minimal Chrome DevTools Protocol driver for headless end-to-end checks.

Needs Google Chrome (or set the CHROME environment variable) and
`pip install websocket-client`.
"""
import base64
import itertools
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

DEFAULT_CHROME = {
    'win32': r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'darwin': '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}.get(sys.platform, 'google-chrome')


class Browser:
    def __init__(self, width=430, height=900, scale=2, mobile=False):
        sk = socket.socket()
        sk.bind(('127.0.0.1', 0))
        port = sk.getsockname()[1]
        sk.close()
        self.proc = subprocess.Popen(
            [os.environ.get('CHROME', DEFAULT_CHROME), '--headless=new', f'--remote-debugging-port={port}',
             f'--user-data-dir={tempfile.mkdtemp(prefix="drees-chrome-")}', '--no-first-run',
             '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
             '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
             f'--window-size={width},{height}', 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        page = None
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=2))
                page = next(t for t in tabs if t['type'] == 'page')
                break
            except Exception:
                time.sleep(0.2)
        if not page:
            raise RuntimeError('Chrome did not start')
        self.ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=120)
        self.ids = itertools.count(1)
        self.logs = []
        for m in ('Runtime.enable', 'Page.enable', 'Log.enable'):
            self.send(m)
        self.send('Emulation.setDeviceMetricsOverride', width=width, height=height, deviceScaleFactor=scale, mobile=mobile)
        if mobile:
            self.send('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)

    def send(self, method, **params):
        mid = next(self.ids)
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            ev = msg.get('method')
            if ev == 'Runtime.consoleAPICalled':
                args = msg['params']['args']
                self.logs.append(msg['params']['type'] + ': ' + ' '.join(str(a.get('value', a.get('description', ''))) for a in args))
            elif ev == 'Runtime.exceptionThrown':
                d = msg['params']['exceptionDetails']
                self.logs.append('EXCEPTION: ' + d.get('text', '') + ' ' + str(d.get('exception', {}).get('description', '')))
            elif ev == 'Log.entryAdded':
                e = msg['params']['entry']
                self.logs.append(f"{e['level']}: {e['text']} {e.get('url', '')}")
            if msg.get('id') == mid:
                if 'error' in msg:
                    raise RuntimeError(f'{method}: {msg["error"]}')
                return msg.get('result', {})

    def js(self, expr):
        r = self.send('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=True)
        if 'exceptionDetails' in r:
            raise RuntimeError(r['exceptionDetails'].get('exception', {}).get('description') or r['exceptionDetails'])
        return r['result'].get('value')

    def goto(self, url):
        self.send('Page.navigate', url=url)
        time.sleep(1.0)

    def shot(self, path):
        with open(path, 'wb') as f:
            f.write(base64.b64decode(self.send('Page.captureScreenshot', format='png')['data']))

    def _mouse(self, typ, x, y, buttons=0, button='none'):
        self.send('Input.dispatchMouseEvent', type=typ, x=x, y=y, button=button, buttons=buttons, clickCount=1)

    def click(self, x, y):
        self._mouse('mouseMoved', x, y)
        self._mouse('mousePressed', x, y, 1, 'left')
        self._mouse('mouseReleased', x, y, 0, 'left')

    def drag(self, x0, y0, x1, y1, steps=12):
        self._mouse('mouseMoved', x0, y0)
        self._mouse('mousePressed', x0, y0, 1, 'left')
        for i in range(1, steps + 1):
            t = i / steps
            self._mouse('mouseMoved', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1, 'left')
            time.sleep(0.012)
        time.sleep(0.05)
        self._mouse('mouseReleased', x1, y1, 0, 'left')

    def tap(self, x, y):
        self.send('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x, 'y': y}])
        self.send('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])

    def touch_drag(self, x0, y0, x1, y1, steps=12):
        self.send('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x0, 'y': y0}])
        for i in range(1, steps + 1):
            t = i / steps
            self.send('Input.dispatchTouchEvent', type='touchMove',
                      touchPoints=[{'x': x0 + (x1 - x0) * t, 'y': y0 + (y1 - y0) * t}])
            time.sleep(0.012)
        self.send('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass
        if sys.platform == 'win32':
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(self.proc.pid)], capture_output=True)
        else:
            self.proc.kill()
