#!/usr/bin/env bun
import { runMain } from "citty"
import { installJaErrorMap } from "@prep-hamster/schema"
import { main } from "./main"

installJaErrorMap()

runMain(main)
