#!/usr/bin/env node
/** 关闭 agent-browser 实例，切换 skill 或排查 daemon 问题时使用 */
import { resetBrowser } from "./browser.mjs";

resetBrowser();
console.log("Browser reset.");
