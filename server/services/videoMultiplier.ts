import fs from 'fs';
import path from 'path';
import {
  MultiplierBlock,
  MultiplierConfig,
  MultiplierMatrixItem,
  VideoJoinerClip,
  VideoJoinerConfig,
} from '../../src/types';
import { db } from '../db';

export interface MultiplierCalculationResult {
  totalPossibleCombinations: number;
  selectedCount: number;
  availableCombinations: MultiplierMatrixItem[];
  hooksCount: number;
  bodiesCount: number;
  ctasCount: number;
  formulaString: string;
}

function sanitizeLabel(label: string): string {
  return (label || 'bloco')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .toUpperCase();
}

/**
 * Calculates the exact matrix of combinations
 */
export function calculateMultiplierMatrix(config: MultiplierConfig): MultiplierCalculationResult {
  const hooks = config.hooks || [];
  const bodies = config.bodies || [];
  const ctas = config.ctas || [];

  const hCount = hooks.length;
  const bCount = bodies.length;
  const cCount = ctas.length;

  const totalPossible = hCount * bCount * cCount;
  const formulaString = `${hCount} Inícios × ${bCount} Meios × ${cCount} Finais = ${totalPossible} combinações`;

  if (totalPossible === 0) {
    return {
      totalPossibleCombinations: 0,
      selectedCount: 0,
      availableCombinations: [],
      hooksCount: hCount,
      bodiesCount: bCount,
      ctasCount: cCount,
      formulaString,
    };
  }

  // Generate all raw combinations
  const allCombinations: Array<{
    hook: MultiplierBlock;
    body: MultiplierBlock;
    cta: MultiplierBlock;
  }> = [];

  for (let h = 0; h < hCount; h++) {
    for (let b = 0; b < bCount; b++) {
      for (let c = 0; c < cCount; c++) {
        allCombinations.push({
          hook: hooks[h],
          body: bodies[b],
          cta: ctas[c],
        });
      }
    }
  }

  // Apply distribution strategy
  let orderedCombinations = [...allCombinations];
  if (config.distributionStrategy === 'balanced_random') {
    // Fisher-Yates with non-consecutive hook penalty
    for (let i = orderedCombinations.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [orderedCombinations[i], orderedCombinations[j]] = [orderedCombinations[j], orderedCombinations[i]];
    }

    // Try to avoid identical consecutive hooks
    for (let i = 1; i < orderedCombinations.length; i++) {
      if (orderedCombinations[i].hook.id === orderedCombinations[i - 1].hook.id && i + 1 < orderedCombinations.length) {
        // Swap with next if possible
        [orderedCombinations[i], orderedCombinations[i + 1]] = [orderedCombinations[i + 1], orderedCombinations[i]];
      }
    }
  }

  // Apply Campaign Limit (1, 5, 10, 25, 50, 75)
  const limit = config.maxCampaignVideos || 75;
  const selectedSlice = orderedCombinations.slice(0, limit);

  const prefix = config.namingPrefix || 'VEO_AUTO';

  const matrixItems: MultiplierMatrixItem[] = selectedSlice.map((comb, idx) => {
    const videoNum = idx + 1;
    const paddedId = `V${String(videoNum).padStart(3, '0')}`;
    const hookClean = sanitizeLabel(comb.hook.label || `H${comb.hook.id}`);
    const bodyClean = sanitizeLabel(comb.body.label || `M${comb.body.id}`);
    const ctaClean = sanitizeLabel(comb.cta.label || `C${comb.cta.id}`);

    const name = `${prefix}_${paddedId}_HOOK_${hookClean}_MEIO_${bodyClean}_FINAL_${ctaClean}`;
    const estDuration =
      (comb.hook.durationSeconds || 3) +
      (comb.body.durationSeconds || 4) +
      (comb.cta.durationSeconds || 3);

    return {
      id: paddedId,
      index: videoNum,
      name,
      hookBlock: comb.hook,
      bodyBlock: comb.body,
      ctaBlock: comb.cta,
      estimatedDurationSeconds: estDuration,
      isSelected: true,
      status: 'pending',
    };
  });

  return {
    totalPossibleCombinations: totalPossible,
    selectedCount: matrixItems.length,
    availableCombinations: matrixItems,
    hooksCount: hCount,
    bodiesCount: bCount,
    ctasCount: cCount,
    formulaString,
  };
}

/**
 * Converts a Multiplier Matrix Item into a ready-to-render VideoJoinerConfig
 */
export function matrixItemToJoinerConfig(
  item: MultiplierMatrixItem,
  globalConfig: MultiplierConfig
): VideoJoinerConfig {
  const blockToClip = (block: MultiplierBlock, idx: number): VideoJoinerClip => {
    const trimStart = block.trimStartSeconds || 0;
    const rawDur = block.durationSeconds || 4;
    const trimEnd = block.trimEndSeconds || 0;
    const effDur = Math.max(0.5, rawDur - trimStart - trimEnd);
    const clipName =
      block.label ||
      (block as any).name ||
      (block as any).originalFileName ||
      `${block.slotType || 'Bloco'} ${idx + 1}`;

    let resolvedFilePath = block.filePath
      ? String(block.filePath).trim().replace(/^["']|["']$/g, '')
      : '';

    // If filePath is empty or does not exist on disk, aggressively resolve
    if (!resolvedFilePath || !fs.existsSync(resolvedFilePath)) {
      if (block.mediaAssetId) {
        try {
          const media = db.getMedia().find((m) => m.id === block.mediaAssetId);
          if (media?.filePath && fs.existsSync(media.filePath)) {
            resolvedFilePath = path.resolve(media.filePath);
          } else if (media) {
            const settings = db.getSettings();
            if (settings?.outputDirectory) {
              const inMediaDir = path.resolve(
                settings.outputDirectory,
                'Media',
                path.basename(media.filePath || media.originalFileName || '')
              );
              if (fs.existsSync(inMediaDir)) {
                resolvedFilePath = inMediaDir;
              }
            }
          }
        } catch {}
      }

      // Check url if available
      if ((!resolvedFilePath || !fs.existsSync(resolvedFilePath)) && block.url) {
        const streamMatch = block.url.match(/stream-local\?path=([^&]+)/);
        if (streamMatch && streamMatch[1]) {
          try {
            const decoded = decodeURIComponent(streamMatch[1]).replace(/^["']|["']$/g, '');
            if (fs.existsSync(decoded)) {
              resolvedFilePath = path.resolve(decoded);
            }
          } catch {}
        }

        const mediaMatch = block.url.match(/\/api\/media\/file[s]?\/([^/?#]+)/);
        if (mediaMatch && mediaMatch[1]) {
          const mId = mediaMatch[1].replace('/stream', '');
          try {
            const media = db.getMedia().find((m) => m.id === mId);
            if (media?.filePath && fs.existsSync(media.filePath)) {
              resolvedFilePath = path.resolve(media.filePath);
            }
          } catch {}
        }
      }

      // Fallback: look for match by name/label in db.getMedia()
      if ((!resolvedFilePath || !fs.existsSync(resolvedFilePath)) && clipName) {
        try {
          const media = db.getMedia().find(
            (m) =>
              m.name === clipName ||
              m.originalFileName === clipName ||
              (m.filePath && path.basename(m.filePath) === clipName)
          );
          if (media?.filePath && fs.existsSync(media.filePath)) {
            resolvedFilePath = path.resolve(media.filePath);
          }
        } catch {}
      }
    }

    console.log(
      `[VideoMultiplier] Converted block #${idx + 1} (${clipName}): resolvedFilePath=${resolvedFilePath || 'NONE'}`
    );

    return {
      id: `${item.id}_clip_${idx}_${block.id}`,
      mediaAssetId: block.mediaAssetId,
      filePath: resolvedFilePath,
      url: block.url,
      name: clipName,
      durationSeconds: rawDur,
      trimStartSeconds: trimStart,
      trimEndSeconds: trimEnd,
      effectiveDuration: effDur,
      volumePercent: block.volumePercent ?? 100,
      isMuted: !!block.isMuted,
      transitionToNext: globalConfig.transitionBetweenBlocks || 'none',
    };
  };

  const clips: VideoJoinerClip[] = [
    blockToClip(item.hookBlock, 0),
    blockToClip(item.bodyBlock, 1),
    blockToClip(item.ctaBlock, 2),
  ];

  return {
    title: item.name,
    outputFileName: item.name,
    preset: 'custom',
    aspectRatio: globalConfig.aspectRatio || '9:16',
    resolution: globalConfig.resolution || '720p',
    fps: globalConfig.fps || 30,
    clips,
    backgroundAudio: globalConfig.backgroundAudio,
    targetDurationSeconds: item.estimatedDurationSeconds,
  };
}
