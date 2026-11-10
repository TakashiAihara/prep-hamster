#!/usr/bin/env bun
// Runs the Maestro flows end to end on this machine: Supabase local (Auth + DB) → migrations → API →
// seed (test user's group and locations) → Metro → emulator → debug APK → flows (scripts/capture-screens.ts)
// → tear everything down. Every run starts from an empty DB, and nothing talks to the Supabase project.
//
// usage:
//   bun run e2e              full run (boots its own headless emulator unless E2E_DEVICE is set)
//   bun run e2e build        only build the debug APK into .cache/e2e (CI builds before booting the emulator)
//   bun run e2e fingerprint  print the cache key of the APK (native fingerprint + Metro port)
//
// env (defaults avoid the ports of `supabase start` / `expo start` so a dev stack can keep running):
//   E2E_SUPABASE_PORT  25321 (DB = +1, shadow DB = -1). Keep it below the ephemeral range
//                      (32768+): docker fails to bind a port an outgoing connection is using
//   E2E_API_PORT       3100
//   E2E_METRO_PORT     8091  (baked into the APK; the debug build fetches JS from 10.0.2.2:<port>)
//   E2E_DEVICE         adb serial of an already running device. Unset: boot E2E_AVD on port 5600
//   E2E_AVD            prep_hamster
//   ANDROID_HOME       Android SDK (emulator / adb / gradle)
//   JAVA_HOME          JDK 17 for gradle

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"

const here = dirname(new URL(import.meta.url).pathname)
const mobileRoot = resolve(here, "..")
const repoRoot = resolve(mobileRoot, "../../../..")
const cacheDir = join(repoRoot, ".cache/e2e")

function portEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const port = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65534) {
    console.error(`[e2e] ${name} must be a port number (1024-65534), got ${raw}`)
    process.exit(2)
  }
  return port
}

const sbPort = portEnv("E2E_SUPABASE_PORT", 25321)
const apiPort = portEnv("E2E_API_PORT", 3100)
const metroPort = portEnv("E2E_METRO_PORT", 8091)
const avd = process.env["E2E_AVD"] ?? "prep_hamster"
const sdk = process.env["ANDROID_HOME"] ?? join(process.env["HOME"] ?? "", "Android/sdk")
const adb = join(sdk, "platform-tools/adb")
const sbWorkdir = join(cacheDir, "supabase")
const sbUrl = `http://127.0.0.1:${sbPort}`
// 10.0.2.2 is the host's loopback as seen from the Android emulator
const hostFromEmulator = "10.0.2.2"

const log = (msg: string) => console.log(`[e2e] ${msg}`)

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd ?? repoRoot, env: opts.env })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status ?? r.signal}`)
  }
}

function capture(cmd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const r = spawnSync(cmd, args, {
    cwd: repoRoot,
    env,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status ?? r.signal}`)
  }
  return r.stdout.trim()
}

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- polling: each try must finish before the next
    if (await check().catch(() => false)) return
    // oxlint-disable-next-line no-await-in-loop -- polling interval
    await Bun.sleep(2000)
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`)
}

async function portFree(port: number): Promise<boolean> {
  try {
    const conn = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } })
    conn.end()
    return false
  } catch {
    return true
  }
}

// --- APK -------------------------------------------------------------------

function fingerprint(): string {
  const out = capture("bunx", ["fingerprint", "fingerprint:generate", mobileRoot])
  const hash = (JSON.parse(out) as { hash?: string }).hash
  if (!hash) throw new Error("@expo/fingerprint returned no hash")
  return `${hash}-${metroPort}`
}

function apkPath(): string {
  return join(cacheDir, `app-debug-${fingerprint()}.apk`)
}

// Only a native change (fingerprint) or another Metro port needs a new APK; JS comes from Metro.
function buildApk(): string {
  const apk = apkPath()
  if (existsSync(apk)) {
    log(`APK up to date: ${apk}`)
    return apk
  }

  // prebuild rewrites the android / ios scripts in package.json; keep the committed file as is
  const pkgPath = join(mobileRoot, "package.json")
  const pkg = readFileSync(pkgPath, "utf-8")
  // Generated and gitignored; a previous build's copy would make prebuild refuse to regenerate it
  rmSync(join(mobileRoot, "android"), { recursive: true, force: true })
  try {
    run("bunx", ["expo", "prebuild", "--platform", "android", "--no-install"], { cwd: mobileRoot })
  } finally {
    writeFileSync(pkgPath, pkg)
  }

  // A stale ANDROID_SDK_ROOT that disagrees with ANDROID_HOME fails the gradle configure step
  const env = { ...process.env, ANDROID_HOME: sdk }
  delete env["ANDROID_SDK_ROOT"]
  run(
    "./gradlew",
    [
      "assembleDebug",
      // the emulator is x86_64; building one ABI instead of four cuts the native build
      "-PreactNativeArchitectures=x86_64",
      `-PreactNativeDevServerPort=${metroPort}`,
    ],
    { cwd: join(mobileRoot, "android"), env },
  )
  mkdirSync(cacheDir, { recursive: true })
  // rename is atomic: an interrupted copy must not look like a cached APK on the next run
  copyFileSync(join(mobileRoot, "android/app/build/outputs/apk/debug/app-debug.apk"), `${apk}.tmp`)
  renameSync(`${apk}.tmp`, apk)
  log(`APK built: ${apk}`)
  return apk
}

// --- services --------------------------------------------------------------

const children: ChildProcess[] = []
const cleanups: (() => void)[] = []

function background(
  name: string,
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const logPath = join(cacheDir, `${name}.log`)
  // The child writes the file itself: nothing is buffered here and lost when this process exits
  const fd = openSync(logPath, "w")
  const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", fd, fd], detached: true })
  // A missing binary is an 'error' event; unhandled, it would crash past the teardown
  child.on("error", (err) => console.error(`[e2e] ${name}: ${err.message}`))
  children.push(child)
  log(`${name} started (log: ${logPath})`)
  return child
}

function startSupabase(): { secretKey: string; publishableKey: string } {
  // Own project_id and ports, so a `supabase start` of this repo (or another E2E checkout) is untouched
  // Line by line against the original, so a new value can never be rewritten by a later rule
  const rules: [RegExp, string][] = [
    [/^project_id = .*$/, `project_id = "prep-hamster-e2e-${sbPort}"`],
    [/^port = 54321$/, `port = ${sbPort}`],
    [/^port = 54322$/, `port = ${sbPort + 1}`],
    [/^shadow_port = 54320$/, `shadow_port = ${sbPort - 1}`],
  ]
  const hits = rules.map(() => 0)
  const config = readFileSync(join(repoRoot, "supabase/config.toml"), "utf-8")
    .split("\n")
    .map((line) => {
      const i = rules.findIndex(([from]) => from.test(line))
      if (i < 0) return line
      hits[i]!++
      return rules[i]![1]
    })
    .join("\n")
  // A miss would start Supabase on the dev ports; a double hit would give two services one port
  const bad = rules.filter((_, i) => hits[i] !== 1)
  if (bad.length > 0) {
    throw new Error(
      `supabase/config.toml: expected one line each for ${bad.map(([r]) => r).join(" ")}`,
    )
  }
  mkdirSync(join(sbWorkdir, "supabase"), { recursive: true })
  writeFileSync(join(sbWorkdir, "supabase/config.toml"), config)

  const stop = () =>
    spawnSync("bunx", ["supabase", "stop", "--no-backup", "--workdir", sbWorkdir], {
      stdio: "inherit",
      timeout: 180_000,
    })
  // A run killed before its teardown leaves the volumes; drop them so the DB starts empty
  if (stop().status !== 0) throw new Error("supabase stop failed; the DB would not start empty")
  cleanups.push(() => {
    const r = stop()
    if (r.status !== 0) {
      throw new Error(
        `supabase stop failed (${r.error?.message ?? r.status}); containers may be left`,
      )
    }
  })
  // Only Auth (gotrue), its gateway (kong) and the DB are used by the app and the API
  run("bunx", [
    "supabase",
    "start",
    "--workdir",
    sbWorkdir,
    "-x",
    "realtime,storage-api,imgproxy,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
  ])
  const status = JSON.parse(
    capture("bunx", ["supabase", "status", "--workdir", sbWorkdir, "-o", "json"]),
  ) as { SECRET_KEY?: string; PUBLISHABLE_KEY?: string }
  if (!status.SECRET_KEY || !status.PUBLISHABLE_KEY) {
    throw new Error("supabase status returned no keys")
  }
  return { secretKey: status.SECRET_KEY, publishableKey: status.PUBLISHABLE_KEY }
}

function devSession(secretKey: string): string {
  return capture("bun", ["run", join(here, "dev-session.ts")], {
    ...process.env,
    SUPABASE_URL: sbUrl,
    SUPABASE_SECRET_KEY: secretKey,
  }).split("\n")[0]!
}

// The flows need the test user to be EDITOR+ of a group with two locations (move needs a target)
async function seed(secretKey: string) {
  const token = new URL(devSession(secretKey)).searchParams.get("access_token")
  if (!token) throw new Error("dev-session returned no access token")
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (res.status !== 201) throw new Error(`seed ${path}: ${res.status} ${await res.text()}`)
    return res.json()
  }
  const { group } = (await post("/v1/groups", { name: "E2E" })) as { group: { id: string } }
  await Promise.all(
    ["冷蔵庫", "パントリー"].map((name) => post("/v1/locations", { groupId: group.id, name })),
  )
  log("seeded the test user's group and locations")
}

// Fixed console port: one E2E run per machine at a time (the port check stops a second one)
const emulatorPort = 5600

async function bootEmulator(): Promise<string> {
  const port = emulatorPort
  const serial = `emulator-${port}`
  background(
    "emulator",
    join(sdk, "emulator/emulator"),
    // -read-only lets another session keep the same AVD open
    [
      "-avd",
      avd,
      "-port",
      String(port),
      "-read-only",
      "-no-window",
      "-no-audio",
      "-no-snapshot",
      "-no-boot-anim",
      "-gpu",
      "swiftshader_indirect",
      "-no-metrics",
    ],
    repoRoot,
    process.env,
  )
  cleanups.push(() =>
    // only a warning: the SIGTERM to the emulator's process group in teardown() follows
    warnIfFailed(
      "adb emu kill",
      spawnSync(adb, ["-s", serial, "emu", "kill"], { stdio: "ignore", timeout: 30_000 }),
    ),
  )
  await waitFor(
    "emulator boot",
    async () => capture(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"]) === "1",
    300_000,
  )
  return serial
}

function warnIfFailed(what: string, r: ReturnType<typeof spawnSync>) {
  if (r.error || r.status !== 0) {
    console.warn(`[e2e] ${what} failed: ${r.error?.message ?? `exit ${r.status ?? r.signal}`}`)
  }
}

// Returns false when a cleanup failed, so the run does not report success over leftovers
function teardown(): boolean {
  let ok = true
  // Cleanups first: the logcat dump needs the emulator, which is one of the children below
  for (const cleanup of cleanups.splice(0).toReversed()) {
    // one failed cleanup must not leave the rest (and the children below) running
    try {
      cleanup()
    } catch (err) {
      console.error(`[e2e] cleanup failed: ${err instanceof Error ? err.message : err}`)
      ok = false
    }
  }
  for (const child of children.splice(0).toReversed()) {
    // detached: the group also holds Metro's / the emulator's own children
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM")
      } catch {}
    }
  }
  return ok
}

// --- main ------------------------------------------------------------------

async function e2e() {
  mkdirSync(cacheDir, { recursive: true })
  // The host side of a dropped connection (#200): the adb server logs its restarts and, for a
  // kill-server, the caller's process chain. Registered first so it runs last and keeps teardown's
  // adb calls too. Assumes the server was started with this process's TMPDIR (true on CI)
  const adbServerLog = join(process.env["TMPDIR"] || "/tmp", `adb.${process.getuid?.() ?? 0}.log`)
  cleanups.push(() => {
    try {
      copyFileSync(adbServerLog, join(cacheDir, "adb-server.log"))
    } catch (err) {
      // diagnostics only, like logcat.log
      console.warn(
        `[e2e] copying ${adbServerLog} failed: ${err instanceof Error ? err.message : err}`,
      )
    }
  })
  // Built first: the port check right before the services start leaves no multi-minute window in
  // which a second run passes it and then stops this run's Supabase (same project_id)
  const apk = buildApk()

  const ports = [sbPort - 1, sbPort, sbPort + 1, apiPort, metroPort]
  // the emulator takes its console port and the next one for adb
  if (!process.env["E2E_DEVICE"]) ports.push(emulatorPort, emulatorPort + 1)
  const free = await Promise.all(ports.map(portFree))
  const busy = ports.filter((_, i) => !free[i])
  if (busy.length > 0) {
    throw new Error(`port ${busy.join(", ")} in use (another E2E run or dev stack?)`)
  }

  const { secretKey, publishableKey } = startSupabase()

  const dbUrl = `postgresql://postgres:postgres@127.0.0.1:${sbPort + 1}/postgres`
  run("bun", ["run", "--filter", "@prep-hamster/db", "db:migrate"], {
    env: { ...process.env, DATABASE_URL: dbUrl },
  })

  background("api", "bun", ["run", "apps/core/api/src/index.ts"], repoRoot, {
    ...process.env,
    PORT: String(apiPort),
    DATABASE_URL: dbUrl,
    SUPABASE_URL: sbUrl,
  })
  await waitFor("API", async () => (await fetch(`http://127.0.0.1:${apiPort}/health`)).ok, 60_000)
  await seed(secretKey)

  // EXPO_PUBLIC_* are inlined by Metro, so the same APK serves any ports / keys
  background("metro", "bunx", ["expo", "start", "--port", String(metroPort)], mobileRoot, {
    ...process.env,
    CI: "1",
    EXPO_PUBLIC_API_BASE_URL: `http://${hostFromEmulator}:${apiPort}`,
    EXPO_PUBLIC_SUPABASE_URL: `http://${hostFromEmulator}:${sbPort}`,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  })
  await waitFor(
    "Metro",
    async () =>
      (await (await fetch(`http://127.0.0.1:${metroPort}/status`)).text()) ===
      "packager-status:running",
    120_000,
  )
  // Bundle once before the first flow: a cold bundle takes longer than the flow waits for sign-in
  const bundle = await fetch(
    `http://127.0.0.1:${metroPort}/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&minify=false`,
  )
  if (!bundle.ok) throw new Error(`Metro could not bundle the app: ${bundle.status}`)
  await bundle.arrayBuffer()
  log("Metro bundled the app")

  const serial = process.env["E2E_DEVICE"] || (await bootEmulator())
  // A busy emulator shows "Pixel Launcher isn't responding" over the app, and every flow then
  // fails to find its screen (seen on CI, also with hide_error_dialogs set). The flows start the
  // app with `am start` and need no launcher; without it the home is Settings' blank FallbackHome.
  // E2E_DEVICE may be someone's everyday emulator: put the launcher back unless it was already off
  const launcher = "com.google.android.apps.nexuslauncher"
  const pm = (...args: string[]) =>
    spawnSync(adb, ["-s", serial, "shell", "pm", ...args], { encoding: "utf-8", timeout: 30_000 })
  const before = pm("list", "packages", "-d")
  // Unknown state (the list failed): leave the launcher alone rather than "restore" it wrongly
  if (before.status !== 0) {
    warnIfFailed("listing disabled packages (Pixel Launcher left as is)", before)
  } else if (!before.stdout.includes(`package:${launcher}`)) {
    const disabled = pm("disable-user", "--user", "0", launcher)
    warnIfFailed("disabling Pixel Launcher", disabled)
    if (disabled.status === 0) {
      cleanups.push(() =>
        warnIfFailed("re-enabling Pixel Launcher", pm("enable", "--user", "0", launcher)),
      )
    }
  }
  run(adb, ["-s", serial, "install", "-r", apk])

  // The first launch on a fresh emulator is far slower than the rest (seen failing whichever flow
  // ran first, at a 30 s or 15 s wait). Launch once up to the sign-in screen before any flow.
  const warmup = join(cacheDir, "warmup.yaml")
  writeFileSync(
    warmup,
    [
      "appId: com.example.prephamster",
      "---",
      "- launchApp:",
      "    clearState: true",
      "- extendedWaitUntil:",
      "    visible:",
      '      text: "Google でサインイン"',
      "    timeout: 180000",
      "",
    ].join("\n"),
  )
  // maestro talks to the device through adb; use the SDK's even when platform-tools is not on PATH
  const pathEnv = `${dirname(adb)}:${process.env["PATH"] ?? ""}`
  // The device log is the only record of what the app did (a JS error, a crash) when a flow fails
  cleanups.push(() => {
    // Straight to the file: a pipe would cap the dump at spawnSync's 1 MiB maxBuffer.
    // adb waits forever on an emulator that died (seen when the host stalled it); bound it
    const fd = openSync(join(cacheDir, "logcat.log"), "w")
    const r = spawnSync(adb, ["-s", serial, "logcat", "-d"], {
      stdio: ["ignore", fd, "ignore"],
      timeout: 60_000,
    })
    closeSync(fd)
    // diagnostics only: a missing log should be visible, not fail the run
    warnIfFailed("adb logcat (logcat.log may be empty or cut short)", r)
  })

  run(
    "maestro",
    [
      "--device",
      serial,
      "test",
      `--debug-output=${join(cacheDir, "maestro/warmup")}`,
      "--flatten-debug-output",
      warmup,
    ],
    { env: { ...process.env, PATH: pathEnv } },
  )
  log("warmed up the app")

  run("bun", ["run", join(here, "capture-screens.ts")], {
    env: {
      ...process.env,
      ANDROID_SERIAL: serial,
      MAESTRO_DEBUG_DIR: join(cacheDir, "maestro"),
      PATH: pathEnv,
      SUPABASE_URL: sbUrl,
      SUPABASE_SECRET_KEY: secretKey,
    },
  })
}

async function main() {
  const command = process.argv[2] ?? "run"
  if (command === "fingerprint") {
    console.log(fingerprint())
    return
  }
  if (command === "build") {
    buildApk()
    return
  }
  if (command !== "run") {
    console.error(`[e2e] unknown command: ${command} (run | build | fingerprint)`)
    process.exit(2)
  }

  // Ctrl-C would otherwise leave the detached emulator / Metro and the containers running
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      teardown()
      process.exit(signal === "SIGINT" ? 130 : 143)
    })
  }

  let failed = false
  try {
    await e2e()
  } catch (err) {
    console.error(`[e2e] ${err instanceof Error ? err.message : err}`)
    failed = true
  } finally {
    if (!teardown()) failed = true
  }
  process.exit(failed ? 1 : 0)
}

await main()
