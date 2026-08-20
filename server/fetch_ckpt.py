from huggingface_hub import snapshot_download
import os
p = snapshot_download(repo_id="myshell-ai/OpenVoiceV2", local_dir="checkpoints_v2")
print("Yuklandi:", p)
for root, dirs, files in os.walk("checkpoints_v2"):
    for f in files:
        fp = os.path.join(root, f)
        print(f"  {fp}  ({os.path.getsize(fp)/1e6:.1f} MB)")
