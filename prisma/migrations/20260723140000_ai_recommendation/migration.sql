-- AiRecommendation：跨业务智能撮合（Step 4）。向前兼容，仅新增。AiTargetType 复用 Step 2 的枚举。

CREATE TABLE "AiRecommendation" (
    "id" TEXT NOT NULL,
    "sourceType" "AiTargetType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" "AiTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasons" TEXT[] NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AiRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiRecommendation_sourceType_sourceId_targetType_targetId_key"
    ON "AiRecommendation"("sourceType", "sourceId", "targetType", "targetId");
CREATE INDEX "AiRecommendation_sourceType_sourceId_score_idx"
    ON "AiRecommendation"("sourceType", "sourceId", "score");
CREATE INDEX "AiRecommendation_targetType_targetId_idx"
    ON "AiRecommendation"("targetType", "targetId");
