/**
 * READ-ONLY spam-account report.
 *
 * Groups accounts that look like the same person: same phone number, same
 * canonical Gmail mailbox, same signup IP, same ad title, or the same contact
 * number on an ad. Nothing is modified.
 *
 * Usage:
 *   node scripts/find-spam-accounts.js
 *   node scripts/find-spam-accounts.js --min-users 2
 *   node scripts/find-spam-accounts.js --out /tmp/spam-report.json
 *
 * If you already know the spammer's email or account id, skip this and run
 * scripts/delete-spam-accounts.js with `--emails` or `--ids`.
 */
import mongoose from "mongoose";
import "dotenv/config";
import { writeFile } from "node:fs/promises";

import { findSpamClusters } from "../services/spamService.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const out = option("--out", "");
const minUsers = Math.max(Number(option("--min-users", "2")) || 2, 2);

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is not set.");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 15000,
});

const clusters = await findSpamClusters({ minUsers });

console.log(`\nSuspicious clusters: ${clusters.length}\n`);

for (const [index, cluster] of clusters.entries()) {
  console.log(`── Cluster ${index + 1} ─────────────────────────────`);
  console.log(
    `   ${cluster.users.length} accounts · ${cluster.adCount} ads · ${cluster.signalCount} shared signal(s)`,
  );
  console.log(`   Signals: ${cluster.signals.map((s) => s.label).join(", ")}`);

  for (const user of cluster.users) {
    const name = `${user.firstName} ${user.lastName}`.trim() || "Unnamed";
    console.log(
      `   • ${name} <${user.email}>  phone=${user.phoneNo || "-"}  ip=${user.signupIp || "-"}  ads=${user.adCount}`,
    );
    console.log(
      `     id=${user._id}  joined=${user.createdAt ? new Date(user.createdAt).toISOString().slice(0, 10) : "-"}`,
    );
  }
  console.log("");
}

if (out) {
  await writeFile(
    out,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), minUsers, clusters },
      null,
      2,
    ),
  );
  console.log(`Report written to ${out}`);
}

console.log(`
Review the clusters above. To remove them:

  node scripts/delete-spam-accounts.js --file ${out || "spam-report.json"}

Add --confirm to actually delete (without it the script is a dry run).
`);

await mongoose.disconnect();
