#!/usr/bin/env python3
import os
import sys

# Default Vault Path (can be overridden by environment variable)
# Assumes standard Windows Documents folder mounted in WSL
VAULT_PATH = os.environ.get("OBSIDIAN_VAULT_PATH", "/mnt/c/Users/Luda/Documents/Obsidian")

def search_obsidian(query):
    if not os.path.exists(VAULT_PATH):
        print(f"[ERROR] Obsidian vault not found at: {VAULT_PATH}")
        print("Please set the OBSIDIAN_VAULT_PATH environment variable to your vault location.")
        print("Example: export OBSIDIAN_VAULT_PATH='/mnt/c/Users/YourName/Documents/Obsidian'")
        return

    print(f"Searching Obsidian Vault ({VAULT_PATH}) for: '{query}'\n")
    
    matches = []
    
    # Walk through vault
    for root, dirs, files in os.walk(VAULT_PATH):
        # Skip system and hidden directories
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        
        for file in files:
            if file.endswith('.md'):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                        if query.lower() in content.lower():
                            # Find the paragraph with the match
                            lines = content.split('\n')
                            for i, line in enumerate(lines):
                                if query.lower() in line.lower():
                                    # Get context (1 line above, 1 line below)
                                    start = max(0, i - 1)
                                    end = min(len(lines), i + 2)
                                    context = "\n".join(lines[start:end])
                                    
                                    # Format relative path
                                    rel_path = os.path.relpath(filepath, VAULT_PATH)
                                    matches.append((rel_path, context))
                                    break # Only show first match per file to save tokens
                except Exception as e:
                    pass

    if not matches:
        print("No results found.")
    else:
        print(f"Found {len(matches)} matching note(s):\n")
        # Limit to top 5 to save context window tokens!
        for filepath, context in matches[:5]:
            print(f"--- File: {filepath} ---")
            print(f"... {context.strip()} ...\n")
            
        if len(matches) > 5:
            print(f"... and {len(matches) - 5} more files omitted to save context tokens.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 .claude/skills/obsidian_search.py \"search query\"")
        sys.exit(1)
        
    query = sys.argv[1]
    search_obsidian(query)
