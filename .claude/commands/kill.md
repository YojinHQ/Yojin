# Kill Command

Kill all running Yojin instances (backend server, dev processes).

## Usage
```
/kill
```

## Implementation

Run the following bash command to find and kill all Yojin processes:

```bash
pkill -SIGTERM -f "src/entry\.ts|dist/src/entry\.js" && echo "Yojin instances terminated." || echo "No running Yojin instances found."
```

Report how many processes were killed, or confirm none were running.
