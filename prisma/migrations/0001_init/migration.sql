-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "epid" TEXT,
    "clusterKey" TEXT,
    "synonymsJson" TEXT NOT NULL,
    "conditionPolicyJson" TEXT NOT NULL,
    "packagingProfile" TEXT NOT NULL,
    "baseRisk" REAL NOT NULL,
    "testChecklistJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Sku_epid_key" ON "Sku"("epid");
CREATE UNIQUE INDEX "Sku_clusterKey_key" ON "Sku"("clusterKey");
CREATE TABLE "HuntRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "seedConfigHash" TEXT NOT NULL,
    "notes" TEXT
);
CREATE TABLE "HuntListItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "huntRunId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "huntScore" REAL NOT NULL,
    "scanQuery" TEXT NOT NULL,
    "scanFiltersJson" TEXT NOT NULL,
    CONSTRAINT "HuntListItem_huntRunId_fkey" FOREIGN KEY ("huntRunId") REFERENCES "HuntRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HuntListItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "OracleSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skuId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "medianTotalCost" REAL NOT NULL,
    "p25TotalCost" REAL NOT NULL,
    "p75TotalCost" REAL NOT NULL,
    "medianShipping" REAL NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "listingDepth" INTEGER NOT NULL,
    "volatilityRatio" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OracleSnapshot_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "ListingSeen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skuId" TEXT NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "legacyItemId" TEXT,
    "title" TEXT NOT NULL,
    "itemPrice" REAL NOT NULL,
    "buyerShipping" REAL,
    "purchaseTotal" REAL NOT NULL,
    "condition" TEXT,
    "epid" TEXT,
    "url" TEXT NOT NULL,
    "sellerMetaJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    CONSTRAINT "ListingSeen_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ListingSeen_skuId_ebayItemId_key" ON "ListingSeen"("skuId", "ebayItemId");
CREATE TABLE "DealScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingSeenId" TEXT NOT NULL,
    "oracleSnapshotId" TEXT NOT NULL,
    "resaleEstimate" REAL NOT NULL,
    "expectedNet" REAL NOT NULL,
    "profit" REAL NOT NULL,
    "roi" REAL NOT NULL,
    "riskFlagsJson" TEXT NOT NULL,
    "riskScore" REAL NOT NULL,
    "liquidityProxy" REAL NOT NULL,
    "score" REAL NOT NULL,
    "decision" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealScore_listingSeenId_fkey" FOREIGN KEY ("listingSeenId") REFERENCES "ListingSeen" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DealScore_oracleSnapshotId_fkey" FOREIGN KEY ("oracleSnapshotId") REFERENCES "OracleSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingSeenId" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "Alert_listingSeenId_fkey" FOREIGN KEY ("listingSeenId") REFERENCES "ListingSeen" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertId" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "boughtPrice" REAL,
    "soldPrice" REAL,
    "daysToSell" INTEGER,
    "notes" TEXT,
    CONSTRAINT "Outcome_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
