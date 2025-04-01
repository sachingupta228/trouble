import type { ScriptFilePath } from "../../../src/Paths/ScriptFilePath";

import { calculateRamUsage } from "../../../src/Script/RamCalculations";
import { RamCosts } from "../../../src/Netscript/RamCostGenerator";
import { Script } from "../../../src/Script/Script";

let BaseCost = 1.6;
let HackCost = 0.1;
let GrowCost = 0.15;
let SleeveGetTaskCost = 4;
let HacknetCost = 4;
let MaxCost = 1024;

let filename = "testfile.js" as ScriptFilePath;
let folderFilename = "test/testfile.js" as ScriptFilePath;
let server = "testserver";
describe("Parsing NetScript code to work out static RAM costs", function () {
  jest.spyOn(console, "error").mockImplementation(() => {});
  /** Tests numeric equality, allowing for floating point imprecision - and includes script base cost */
  function expectCost(val: number | undefined, expected: number) {
    let expectedWithBase = Math.min(expected + BaseCost, MaxCost);
    expect(val).toBeGreaterThanOrEqual(expectedWithBase - 100 * Number.EPSILON);
    expect(val).toBeLessThanOrEqual(expectedWithBase + 100 * Number.EPSILON);
  }

  describe("Single files with basic NS functions", function () {
    it("Empty main function", async function () {
      let code = `
        export async function main(ns) { }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, 0);
    });

    it("Free NS function directly in main", async function () {
      let code = `
        export async function main(ns) {
          ns.print("Slum snakes r00l!");
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, 0);
    });

    it("Single simple base NS function directly in main", async function () {
      let code = `
        export async function main(ns) {
          await ns.hack("joesguns");
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, HackCost);
    });

    it("Single simple base NS function directly in main with differing arg name", async function () {
      let code = `
        export async function main(X) {
          await X.hack("joesguns");
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, HackCost);
    });

    it("Repeated simple base NS function directly in main", async function () {
      let code = `
        export async function main(ns) {
          await ns.hack("joesguns");
          await ns.hack("joesguns");
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, HackCost);
    });

    it("Multiple simple base NS functions directly in main", async function () {
      let code = `
        export async function main(ns) {
          await ns.hack("joesguns");
          await ns.grow("joesguns");
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, HackCost + GrowCost);
    });

    it("Simple base NS functions in a referenced function", async function () {
      let code = `
        export async function main(ns) {
          doHacking(ns);
        }
        async function doHacking(ns) {
          await ns.hack("joesguns");
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, HackCost);
    });

    it("Simple base NS functions in a referenced class", async function () {
      let code = `
        export async function main(ns) {
          await new Hacker(ns).doHacking();
        }
        class Hacker {
          ns;
          constructor(ns) { this.ns = ns; }
          async doHacking() { await this.ns.hack("joesguns"); }
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, HackCost);
    });

    it("Simple base NS functions in a referenced class", async function () {
      let code = `
        export async function main(ns) {
          await new Hacker(ns).doHacking();
        }
        class Hacker {
          #ns;
          constructor(ns) { this.#ns = ns; }
          async doHacking() { await this.#ns.hack("joesguns"); }
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, HackCost);
    });
  });

  describe("Functions that can be confused with NS functions", function () {
    it("Function 'get' that can be confused with Stanek.get", async function () {
      let code = `
        export async function main(ns) {
          get();
        }
        function get() { return 0; }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, 0);
    });

    it("Function 'purchaseNode' that can be confused with Hacknet.purchaseNode", async function () {
      let code = `
        export async function main(ns) {
          purchaseNode();
        }
        function purchaseNode() { return 0; }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      // Works at present, because the parser checks the namespace only, not the function name
      expectCost(calculated, 0);
    });

    // TODO: once we fix static parsing this should pass
    it.skip("Function 'getTask' that can be confused with Sleeve.getTask", async function () {
      let code = `
        export async function main(ns) {
          getTask();
        }
        function getTask() { return 0; }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, 0);
    });
  });

  describe("Single files with non-core NS functions", function () {
    it("Hacknet NS function with a cost from namespace", async function () {
      let code = `
        export async function main(ns) {
          ns.hacknet.purchaseNode(0);
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, HacknetCost);
    });

    it("Sleeve functions with an individual cost", async function () {
      let code = `
        export async function main(ns) {
          ns.sleeve.getTask(3);
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, SleeveGetTaskCost);
    });
  });

  describe("Imported files", function () {
    it("Simple imported function with no cost", async function () {
      let libCode = `
        export function dummy() { return 0; }
      `;
      let lib = new Script("libTest.js" as ScriptFilePath, libCode);

      let code = `
        import { dummy } from "libTest";
        export async function main(ns) {
          dummy();
        }
      `;
      let calculated = calculateRamUsage(
        code,
        filename,
        server,
        new Map([["libTest.js" as ScriptFilePath, lib]]),
      ).cost;
      expectCost(calculated, 0);
    });

    it("Imported ns function", async function () {
      let libCode = `
        export async function doHack(ns) { return await ns.hack("joesguns"); }
      `;
      let lib = new Script("libTest.js" as ScriptFilePath, libCode);

      let code = `
        import { doHack } from "libTest";
        export async function main(ns) {
          await doHack(ns);
        }
      `;
      let calculated = calculateRamUsage(
        code,
        filename,
        server,
        new Map([["libTest.js" as ScriptFilePath, lib]]),
      ).cost;
      expectCost(calculated, HackCost);
    });

    it("Importing a single function from a library that exports multiple", async function () {
      let libCode = `
        export async function doHack(ns) { return await ns.hack("joesguns"); }
        export async function doGrow(ns) { return await ns.grow("joesguns"); }
      `;
      let lib = new Script("libTest.js" as ScriptFilePath, libCode);

      let code = `
        import { doHack } from "libTest";
        export async function main(ns) {
          await doHack(ns);
        }
      `;
      let calculated = calculateRamUsage(
        code,
        filename,
        server,
        new Map([["libTest.js" as ScriptFilePath, lib]]),
      ).cost;
      expectCost(calculated, HackCost);
    });

    it("Importing all functions from a library that exports multiple", async function () {
      let libCode = `
        export async function doHack(ns) { return await ns.hack("joesguns"); }
        export async function doGrow(ns) { return await ns.grow("joesguns"); }
      `;
      let lib = new Script("libTest.js" as ScriptFilePath, libCode);

      let code = `
        import * as test from "libTest";
        export async function main(ns) {
          await test.doHack(ns);
        }
      `;
      let calculated = calculateRamUsage(
        code,
        filename,
        server,
        new Map([["libTest.js" as ScriptFilePath, lib]]),
      ).cost;
      expectCost(calculated, HackCost + GrowCost);
    });

    it("Using every function in the API costs MaxCost", () => {
      let lines: string[] = [];
      for (let [key, val] of Object.entries(RamCosts)) {
        if (typeof val === "object") {
          let namespace = key;
          for (let name of Object.keys(val)) {
            lines.push(`ns.${namespace}.${name}()`);
          }
        } else {
          lines.push(`ns.${key}()`);
        }
      }
      let code = `
        export async function main(ns) {
          ${lines.join("\n")};
        }
      `;
      let calculated = calculateRamUsage(code, filename, server, new Map()).cost;
      expectCost(calculated, MaxCost);
    });

    // TODO: once we fix static parsing this should pass
    it.skip("Importing a function from a library that contains a class", async function () {
      let libCode = `
        export async function doHack(ns) { return await ns.hack("joesguns"); }
        class Grower {
          ns;
          constructor(ns) { this.ns = ns; }
          async doGrow() { return await this.ns.grow("joesguns"); }
        }
      `;
      let lib = new Script("libTest.js" as ScriptFilePath, libCode);

      let code = `
        import * as test from "libTest";
        export async function main(ns) {
          await test.doHack(ns);
        }
      `;
      let calculated = calculateRamUsage(
        code,
        filename,
        server,
        new Map([["libTest.js" as ScriptFilePath, lib]]),
      ).cost;
      expectCost(calculated, HackCost);
    });

    it("Importing a function from a library that creates a class in a function", async function () {
      let libCode = `
          export function createClass() {
            class Grower {
              ns;
              constructor(ns) { this.ns = ns; }
              async doGrow() { return await this.ns.grow("joesguns"); }
            }
            return Grower;
          }
        `;
      let lib = new Script("libTest.js" as ScriptFilePath, libCode);

      let code = `
          import { createClass } from "libTest";

          export async function main(ns) {
            let grower = createClass();
            let growerInstance = new grower(ns);
            await growerInstance.doGrow();
          }
        `;
      let calculated = calculateRamUsage(
        code,
        filename,
        server,
        new Map([["libTest.js" as ScriptFilePath, lib]]),
      ).cost;
      expectCost(calculated, GrowCost);
    });

    it("Importing with a relative path - One Layer Deep", async function () {
      let libCode = `
          export async function testRelative(ns) {
              await ns.hack("n00dles")
          }
        `;
      let lib = new Script("test/libTest.js" as ScriptFilePath, libCode);
      let code = `
          import { testRelative } from "./libTest";

          export async function main(ns) {
            await testRelative(ns)
          }
        `;
      let calculated = calculateRamUsage(
        code,
        folderFilename,
        server,
        new Map([["test/libTest.js" as ScriptFilePath, lib]]),
      ).cost;
      expectCost(calculated, HackCost);
    });
    it("Importing with a relative path - Two Layer Deep", async function () {
      let libNameOne = "test/libTestOne.js" as ScriptFilePath;
      let libNameTwo = "test/libTestTwo.js" as ScriptFilePath;

      let libCodeOne = `
          import { testRelativeAgain } from "./libTestTwo";
          export function testRelative(ns) {
              return testRelativeAgain(ns)
          }
        `;
      let libScriptOne = new Script(libNameOne, libCodeOne);

      let libCodeTwo = `
          export function testRelativeAgain(ns) {
              return ns.hack("n00dles")
          }
        `;
      let libScriptTwo = new Script(libNameTwo, libCodeTwo);

      let code = `
          import { testRelative } from "./libTestOne";

          export async function main(ns) {
            await testRelative(ns)
          }
        `;
      let calculated = calculateRamUsage(
        code,
        folderFilename,
        server,
        new Map([
          [libNameOne, libScriptOne],
          [libNameTwo, libScriptTwo],
        ]),
      ).cost;
      expectCost(calculated, HackCost);
    });
    it("Importing with a relative path - possible path conflict", async function () {
      let libNameOne = "foo/libTestOne.js" as ScriptFilePath;
      let libNameTwo = "foo/libTestTwo.js" as ScriptFilePath;
      let incorrect_libNameTwo = "test/libTestTwo.js" as ScriptFilePath;

      let libCodeOne = `
          import { testRelativeAgain } from "./libTestTwo";
          export function testRelative(ns) {
              return testRelativeAgain(ns)
          }
        `;
      let libScriptOne = new Script(libNameOne, libCodeOne);

      let libCodeTwo = `
          export function testRelativeAgain(ns) {
              return ns.hack("n00dles")
          }
        `;
      let libScriptTwo = new Script(libNameTwo, libCodeTwo);

      let incorrect_libCodeTwo = `
          export function testRelativeAgain(ns) {
              return ns.grow("n00dles")
          }
        `;
      let incorrect_libScriptTwo = new Script(incorrect_libNameTwo, incorrect_libCodeTwo);

      let code = `
          import { testRelative } from "foo/libTestOne";

          export async function main(ns) {
            await testRelative(ns)
          }
        `;
      let calculated = calculateRamUsage(
        code,
        folderFilename,
        server,
        new Map([
          [libNameOne, libScriptOne],
          [libNameTwo, libScriptTwo],
          [incorrect_libNameTwo, incorrect_libScriptTwo],
        ]),
      ).cost;
      expectCost(calculated, HackCost);
    });
  });
});
