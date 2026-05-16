-- CreateEnum
CREATE TYPE "EnvelopeStatus" AS ENUM ('draft', 'sent', 'partially_signed', 'completed', 'declined', 'voided', 'expired');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('pending', 'sent', 'signed', 'declined');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('signature', 'initial', 'date', 'text', 'checkbox');

-- CreateEnum
CREATE TYPE "RoutingMode" AS ENUM ('sequential', 'parallel');

-- CreateTable
CREATE TABLE "Envelope" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" "EnvelopeStatus" NOT NULL DEFAULT 'draft',
    "routingMode" "RoutingMode" NOT NULL DEFAULT 'sequential',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "Envelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeDocument" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "storagePath" TEXT,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvelopeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeRecipient" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'pending',
    "consentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signatureDataUrl" TEXT,
    "initialDataUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvelopeRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeField" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "page" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "value" TEXT,

    CONSTRAINT "EnvelopeField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeAudit" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "message" TEXT NOT NULL,

    CONSTRAINT "EnvelopeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeSignedPdf" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvelopeSignedPdf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Envelope_createdById_idx" ON "Envelope"("createdById");

-- CreateIndex
CREATE INDEX "Envelope_status_idx" ON "Envelope"("status");

-- CreateIndex
CREATE INDEX "Envelope_updatedAt_idx" ON "Envelope"("updatedAt");

-- CreateIndex
CREATE INDEX "EnvelopeDocument_envelopeId_idx" ON "EnvelopeDocument"("envelopeId");

-- CreateIndex
CREATE INDEX "EnvelopeRecipient_envelopeId_order_idx" ON "EnvelopeRecipient"("envelopeId", "order");

-- CreateIndex
CREATE INDEX "EnvelopeField_envelopeId_idx" ON "EnvelopeField"("envelopeId");

-- CreateIndex
CREATE INDEX "EnvelopeField_recipientId_idx" ON "EnvelopeField"("recipientId");

-- CreateIndex
CREATE INDEX "EnvelopeAudit_envelopeId_at_idx" ON "EnvelopeAudit"("envelopeId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "EnvelopeSignedPdf_envelopeId_key" ON "EnvelopeSignedPdf"("envelopeId");

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeDocument" ADD CONSTRAINT "EnvelopeDocument_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeRecipient" ADD CONSTRAINT "EnvelopeRecipient_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeField" ADD CONSTRAINT "EnvelopeField_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeAudit" ADD CONSTRAINT "EnvelopeAudit_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeSignedPdf" ADD CONSTRAINT "EnvelopeSignedPdf_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
