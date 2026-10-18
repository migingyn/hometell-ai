# Model and data provenance

The service uses [Dpngtm/wav2vec2-emotion-recognition](https://huggingface.co/Dpngtm/wav2vec2-emotion-recognition) pinned to revision `033a5751a5bbe5b0b67c2c71e6102c38de35a346`. It is an English Wav2Vec2 classification model. We use the checkpoint's actual `id2label` mapping (`angry`, `calm`, `disgust`, `fearful`, `happy`, `sad`, `surprised`), which differs in naming from the card's merged neutral/calm description. The [model card at that revision](https://huggingface.co/Dpngtm/wav2vec2-emotion-recognition/blob/033a5751a5bbe5b0b67c2c71e6102c38de35a346/README.md) declares MIT. The base [facebook/wav2vec2-base-960h](https://huggingface.co/facebook/wav2vec2-base-960h) declares Apache-2.0.

Only standard installed [Transformers Wav2Vec2](https://huggingface.co/docs/transformers/model_doc/wav2vec2) code and pinned safetensors weights are loaded. `trust_remote_code=False` is explicit. Model weights and third-party training code are not committed. `uv.lock` pins dependencies and their distributions.

The model card lists TESS, CREMA-D, SAVEE, and RAVDESS as training corpora. Model-card licensing does **not** establish clearance of every underlying dataset for commercial deployment. In particular, [RAVDESS's original authors](https://zenodo.org/records/1188976) specify CC BY-NC-SA 4.0 and offer separate commercial licensing. Treat this integration as a noncommercial hackathon/research prototype until the data/weight rights are reviewed or the model is replaced with a cleared one. No training dataset is bundled here.

Relevant original corpus sources:

- [RAVDESS — Livingstone and Russo](https://zenodo.org/records/1188976), DOI [10.1371/journal.pone.0196391](https://doi.org/10.1371/journal.pone.0196391).
- [CREMA-D — original repository and license](https://github.com/CheyneyComputerScience/CREMA-D).
- [TESS — University of Toronto original archive](https://tspace.library.utoronto.ca/handle/1807/24487).
- [SAVEE — University of Surrey](http://kahlan.eps.surrey.ac.uk/savee/).

The model is not trained or validated to recognize dying, medical instability, disaster severity, or actionable panic. We do not reuse its reported validation metric as a claim about our system. Our contribution is caller isolation, quality gates, bounded local inference, structured evidence, and integration with situation-based operator prioritization.

Public acted speech may be used for a local inference smoke check. Such a check establishes that real audio reaches the model; it is not an independent holdout evaluation because the checkpoint may have trained on that corpus. Local fixtures remain ignored and do not contain actual caller data.
