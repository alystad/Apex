import { runBaseballImpactSanityChecks } from "../../src/ratings/baseball/BaseballRankingEngine";

const checks = runBaseballImpactSanityChecks();
const failed = checks.filter((check) => !check.passed);

checks.forEach((check) => {
  const status = check.passed ? "PASS" : "FAIL";
  console.log(`${status} ${check.name} :: ${check.details}`);
});

if (failed.length > 0) {
  process.exitCode = 1;
}
