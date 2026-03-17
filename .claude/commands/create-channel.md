# Create Channel Command

Scaffold a new channel plugin.

## Usage
```
/create-channel <channel-name>
```

## What Gets Created

```
channels/{channel-name}/
├── index.ts              # Plugin entry point (exports YojinPlugin)
├── yojin.plugin.json     # Plugin metadata manifest
└── src/
    └── channel.ts        # ChannelPlugin implementation
```

## Implementation

When invoked with `$ARGUMENTS`:

1. Validate the channel name (lowercase, no spaces)
2. Create the directory structure under `channels/<channel-name>/`
3. Implement the `ChannelPlugin` interface from `src/plugins/types.ts`:
   - `messagingAdapter` — send/receive messages
   - `authAdapter` — token validation
   - `setupAdapter` — initialization and teardown
   - `capabilities` — threading, reactions, files, editing support
4. Create `yojin.plugin.json` manifest with id, name, kind: "channel"
5. Export as `YojinPlugin` in `index.ts`

The channel name from the command is: $ARGUMENTS
