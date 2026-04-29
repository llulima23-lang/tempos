import json

with open(r"C:\Users\sup.luciana\Desktop\AntiGravity\BANCO DE HORAS\data.json", "r", encoding="utf-8") as f:
    data = json.load(f)

credito = 0
deficit = 0
for r in data["records"]:
    if r["agente"] == "Celiane Lourenço de Sousa":
        credito += r.get("credito", 0)
        deficit += r.get("deficit", 0)

print(f"Credito: {credito}s ({credito/3600}h)")
print(f"Deficit: {deficit}s ({deficit/3600}h)")
