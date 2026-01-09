from unstructured.partition.auto import partition
import torch

print("--------------------------------------------------")
print(f"PyTorch Version: {torch.__version__}")
print(f"PyTorch CUDA Available: {torch.cuda.is_available()}")
print("--------------------------------------------------")

try:
    # 1. Create a dummy file to test
    with open("test.txt", "w") as f:
        f.write("This is a test document for unstructured.")
    
    # 2. Try to read it
    print("Testing Unstructured partition...")
    elements = partition("test.txt")
    
    # 3. Report Success
    print("\n✅ Unstructured successfully partitioned the file!")
    print(f"Found {len(elements)} elements.")
    print(f"Content: {elements[0].text}")

except Exception as e:
    print(f"\n❌ Error: {e}")