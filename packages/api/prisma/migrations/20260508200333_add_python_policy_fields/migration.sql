-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "allowPython" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowPythonNet" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxConcurrentPythonRuns" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "maxPythonCpuCores" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "maxPythonMemoryMb" INTEGER NOT NULL DEFAULT 512,
ADD COLUMN     "maxPythonTimeoutSecs" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "pythonPackageAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[];
