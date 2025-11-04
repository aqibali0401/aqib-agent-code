import {
  createWriteStream,
  createReadStream,
  statSync,
  existsSync,
  mkdirSync,
} from 'fs';
import { join, resolve, basename } from 'path';
import { createHash } from 'crypto';
import archiver from 'archiver';
import fs, { writeFileSync } from 'fs';
import dotenv from 'dotenv';

// Always resolve .env relative to the project root
dotenv.config({ path: resolve(__dirname, '../.env') });

interface ManifestData {
  version: string;
  artifact: string;
  checksum: string;
  description: string;
  lastUpdated: string;
  size: number;
  format: string;
  targetApp: string;
}

class BuildAndPackageUtility {
  private readonly projectRoot: string;
  private readonly outputDir: string;
  private readonly manifestArtifactUrl: string;
  private readonly manifestDescription: string;
  private readonly manifestVersion: string;

  constructor() {
    this.projectRoot = resolve(__dirname, '..');

    // Read version from package.json
    const packageJsonPath = join(this.projectRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    // Read from environment variables or use defaults
    this.outputDir = process.env.BUILD_OUTPUT_DIR || 'D:\\QSC';
    console.log(process.env.BUILD_OUTPUT_DIR, this.outputDir);
    this.manifestArtifactUrl = process.env.MANIFEST_ARTIFACT_URL || '';

    this.manifestDescription = packageJson.description;
    // Use version from package.json, or fallback to env variable, or default
    this.manifestVersion = packageJson.version;

    console.log(`Project Root: ${this.projectRoot}`);
    console.log(`Output Directory: ${this.outputDir}`);
    console.log(`Package Version: ${this.manifestVersion}`);
  }

  /**
   * Main execution method
   */
  async execute(): Promise<void> {
    try {
      console.log('='.repeat(60));
      console.log('Build and Package Utility');
      console.log('='.repeat(60));
      console.log();

      // Step 1: Create output directory if it doesn't exist
      this.ensureOutputDirectory();

      // Step 2: Create zip file
      const zipFilePath = await this.createZipFile();

      // Step 3: Calculate checksum
      const checksum = await this.calculateChecksum(zipFilePath);

      // Step 4: Get file size
      const fileSize = this.getFileSize(zipFilePath);

      // Step 5: Create manifest
      await this.createManifest(zipFilePath, checksum, fileSize);

      console.log();
      console.log('='.repeat(60));
      console.log('Build and Package completed successfully!');
      console.log('='.repeat(60));
    } catch (error) {
      console.error('ERROR: Build and package failed:', error);
      throw error;
    }
  }

  /**
   * Ensure output directory exists
   */
  private ensureOutputDirectory(): void {
    if (!existsSync(this.outputDir)) {
      console.log(`Creating output directory: ${this.outputDir}`);
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Create zip file of the entire repository
   */
  private async createZipFile(): Promise<string> {
    console.log('Step 2: Creating zip file...');
    console.log('-'.repeat(60));

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .split('.')[0];
    const zipFileName = `agent-v${this.manifestVersion}-${timestamp}.zip`;
    const zipFilePath = join(this.outputDir, zipFileName);

    console.log(`Creating zip: ${zipFileName}`);
    console.log(`Output path: ${zipFilePath}`);

    return new Promise((resolve, reject) => {
      try {
        const output = createWriteStream(zipFilePath);
        const archive = archiver('zip', {
          zlib: { level: 9 }, // Maximum compression
        });

        let totalFiles = 0;
        let totalBytes = 0;

        // Handle archive events
        output.on('close', () => {
          totalBytes = archive.pointer();
          console.log(`Zip created successfully`);
          console.log(`Total files: ${totalFiles}`);
          console.log(`Total size: ${this.formatBytes(totalBytes)}`);
          console.log();
          resolve(zipFilePath);
        });

        archive.on('error', (err: Error) => {
          reject(err);
        });

        archive.on('entry', () => {
          totalFiles++;
        });

        archive.on('progress', (progress: archiver.ProgressData) => {
          const percentage = Math.round(
            (progress.fs.processedBytes / progress.fs.totalBytes) * 100
          );
          process.stdout.write(
            `\r  Progress: ${percentage}% (${totalFiles} files)`
          );
        });

        // Pipe archive data to the file
        archive.pipe(output);

        // Add all files and folders to the archive
        // Include everything: source files, build files, node_modules, .env, etc.
        console.log('Adding files to archive...');

        // Add the entire project directory
        archive.directory(
          this.projectRoot,
          false,
          (entry: archiver.EntryData) => {
            // Exclude only the output directory itself if it's inside the project
            if (entry.name.includes(this.outputDir)) {
              return false;
            }
            // Exclude existing zip files in the project root
            if (entry.name.endsWith('.zip') && entry.prefix === '') {
              return false;
            }
            return entry;
          }
        );

        // Finalize the archive
        archive.finalize();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Calculate SHA-256 checksum of the zip file
   */
  private async calculateChecksum(
    filePath: string,
    algorithm: string = 'sha256'
  ): Promise<string> {
    console.log('Step 3: Calculating checksum...');
    console.log('-'.repeat(60));

    return new Promise((resolve, reject) => {
      try {
        const hash = createHash(algorithm);
        const stream = createReadStream(filePath);

        stream.on('data', (data) => {
          hash.update(data);
        });

        stream.on('end', () => {
          const checksum = hash.digest('hex');
          console.log(`Checksum (${algorithm}): ${checksum}`);
          console.log();
          resolve(checksum);
        });

        stream.on('error', (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get file size in bytes
   */
  private getFileSize(filePath: string): number {
    const stats = statSync(filePath);
    return stats.size;
  }

  /**
   * Create manifest.json file
   */
  private async createManifest(
    zipFilePath: string,
    checksum: string,
    fileSize: number
  ): Promise<void> {
    console.log('Step 4: Creating manifest.json...');
    console.log('-'.repeat(60));

    // Extract zip file name without extension
    const zipFileName = basename(zipFilePath, '.zip');

    const manifestData: ManifestData = {
      version: this.manifestVersion,
      artifact: this.manifestArtifactUrl,
      checksum: checksum,
      description: this.manifestDescription,
      lastUpdated: new Date().toISOString(),
      size: fileSize,
      format: 'zip',
      targetApp: zipFileName,
    };

    const manifestPath = join(this.outputDir, 'manifest.json');

    try {
      writeFileSync(
        manifestPath,
        JSON.stringify(manifestData, null, 2),
        'utf8'
      );

      console.log(`Manifest created: ${manifestPath}`);
      console.log();
      console.log('Manifest Contents:');
      console.log('-'.repeat(60));
      console.log(JSON.stringify(manifestData, null, 2));
      console.log();
    } catch (error) {
      console.error('Failed to create manifest:', error);
      throw error;
    }
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Execute the utility
const utility = new BuildAndPackageUtility();
utility.execute().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
