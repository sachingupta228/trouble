<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [bitburner](./bitburner.md) &gt; [RunningScript](./bitburner.runningscript.md) &gt; [dynamicRamUsage](./bitburner.runningscript.dynamicramusage.md)

## RunningScript.dynamicRamUsage property

The dynamic RAM usage of (one thread of) this script instance. Does not affect overall RAM consumption (ramUsage is for that), but rather shows how much of the reserved RAM is currently in use via all the ns functions the script has called. Initially 1.6GB, this increases as new functions are called.

Only set for scripts that are still running.

**Signature:**

```typescript
dynamicRamUsage: number | undefined;
```
