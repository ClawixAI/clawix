-- Add whatsappJid field to User model for WhatsApp channel routing
ALTER TABLE "User" ADD COLUMN "whatsappJid" TEXT;
CREATE UNIQUE INDEX "User_whatsappJid_key" ON "User"("whatsappJid");
