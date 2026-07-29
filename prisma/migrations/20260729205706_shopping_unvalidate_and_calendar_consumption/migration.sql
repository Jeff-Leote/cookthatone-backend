-- AlterTable
ALTER TABLE "shopping_items" ADD COLUMN     "purchased_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "calendar_entry_consumptions" (
    "id" TEXT NOT NULL,
    "calendar_entry_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "Unit" NOT NULL,

    CONSTRAINT "calendar_entry_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_entry_consumptions_calendar_entry_id_ingredient_id_key" ON "calendar_entry_consumptions"("calendar_entry_id", "ingredient_id");

-- AddForeignKey
ALTER TABLE "calendar_entry_consumptions" ADD CONSTRAINT "calendar_entry_consumptions_calendar_entry_id_fkey" FOREIGN KEY ("calendar_entry_id") REFERENCES "calendar_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_entry_consumptions" ADD CONSTRAINT "calendar_entry_consumptions_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
