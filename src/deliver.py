"""Invoke the configured receiver without printing its identity or payload."""
import json, os, subprocess, sys
from pathlib import Path
try:
    result = subprocess.run([
        'aws', 'lambda', 'invoke', '--function-name', os.environ['RECEIVER_FUNCTION'],
        '--invocation-type', 'RequestResponse', '--cli-binary-format', 'raw-in-base64-out',
        '--payload', 'fileb://work/payload.json', 'work/response.json', '--no-cli-pager',
    ], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Receiver invocation failed')
    metadata = json.loads(result.stdout)
    response = json.loads(Path('work/response.json').read_text())
    if metadata.get('FunctionError') or response.get('accepted') is not True:
        raise RuntimeError('Receiver rejected collection')
    print('Receiver accepted collection')
except Exception:
    print('Delivery failed; inspect receiver privately.', file=sys.stderr)
    sys.exit(1)
