#!/usr/bin/env python3
"""Local network server for the creative testing dashboard.
Run: python3 server.py
Open from any device on the same network.
"""

import http.server
import socketserver
import socket
import os
import sys
import webbrowser

PORT = 8899
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def get_local_ip():
    """Get the machine's local network IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        client = self.address_string()
        print(f"  {client} — {args[0]}")

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

def main():
    local_ip = get_local_ip()

    print()
    print("=" * 56)
    print("  Creative Testing Dashboard — Local Server")
    print("=" * 56)
    print()
    print(f"  Этот компьютер:  http://localhost:{PORT}/dashboard.html")
    print(f"  Другие устройства: http://{local_ip}:{PORT}/dashboard.html")
    print()
    print("  Откройте ссылку выше на любом устройстве")
    print("  в той же Wi-Fi / локальной сети.")
    print()
    print("  Для остановки нажмите Ctrl+C")
    print("=" * 56)
    print()

    with ReusableTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        try:
            webbrowser.open(f"http://localhost:{PORT}/dashboard.html")
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Сервер остановлен.")
            sys.exit(0)

if __name__ == "__main__":
    main()
