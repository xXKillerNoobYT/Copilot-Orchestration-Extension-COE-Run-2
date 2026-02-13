var fs=require("fs");
var L=[];
var f="src/core/custom-agent-builder.ts";
var c=fs.readFileSync(f,"utf8");
fs.writeFileSync("gen-cab-p2.js","// part 2 placeholder");
console.log("Part 1 ready, file has "+c.length+" chars");
