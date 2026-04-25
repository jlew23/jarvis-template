import http.server
import socketserver
import json
import os
import hashlib
import re

PORT = 8080
HISTORY_FILE = os.path.join(os.path.dirname(__file__), '..', '.aider.chat.history.md')
CONTEXT_LIMIT = 32768 # Default Qwen 14B context limit

def get_spoken_text(content):
    # Get the last 2000 characters to save processing
    tail = content[-2000:]
    # Split by common user markers to try and get just the assistant part
    parts = re.split(r'#### User:|#### /|>\s+', tail)
    last_part = parts[-1] if len(parts) > 0 else tail
    
    # Strip markdown code blocks
    text_only = re.sub(r'```.*?```', ' I have provided some code for this. ', last_part, flags=re.DOTALL)
    # Strip inline code
    text_only = re.sub(r'`.*?`', 'code snippet', text_only)
    # Strip markdown symbols
    text_only = text_only.replace('*', '').replace('#', '').replace('>', '').strip()
    
    # Limit length so TTS doesn't read an essay
    if len(text_only) > 300:
        text_only = text_only[:300] + "... and so on."
        
    return text_only

class JarvisDashboardHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/tokens':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            token_count = 0
            if os.path.exists(HISTORY_FILE):
                with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                    content = f.read()
                    token_count = int(len(content) / 3.5)
            
            response = {
                "used": token_count,
                "limit": CONTEXT_LIMIT,
                "percentage": min(100, (token_count / CONTEXT_LIMIT) * 100) if CONTEXT_LIMIT > 0 else 0
            }
            
            self.wfile.write(json.dumps(response).encode('utf-8'))
            
        elif self.path == '/api/latest_message':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            text = ""
            file_hash = ""
            if os.path.exists(HISTORY_FILE):
                with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                    content = f.read()
                    file_hash = hashlib.md5(content.encode()).hexdigest()
                    text = get_spoken_text(content)
            
            response = {
                "hash": file_hash,
                "text": text
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
            
        elif self.path == '/api/log':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            log_lines = []
            if os.path.exists(HISTORY_FILE):
                with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                    # Get last 100 lines for the log
                    lines = f.readlines()
                    log_lines = lines[-100:] if len(lines) > 100 else lines
            
            response = {
                "log": "".join(log_lines)
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
            
        else:
            # Serve static files from the dashboard directory
            super().do_GET()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"[JARVIS HUD] Booting up visual interface...")
    with socketserver.TCPServer(("", PORT), JarvisDashboardHandler) as httpd:
        print(f"[JARVIS HUD] Serving at http://localhost:{PORT}")
        httpd.serve_forever()
