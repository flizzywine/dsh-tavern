export function comfyGraph() {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'fixture-model.safetensors' } },
    '2': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 2 } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive', clip: ['1', 1] } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: 'negative stays', clip: ['1', 1] } },
    '5': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['2', 0], seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'Tavern' } }
  }
}
