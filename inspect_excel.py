import openpyxl

LOCAL_EXCEL = r"C:\Users\sup.luciana\Desktop\AntiGravity\BANCO DE HORAS\TEMPOS_2026.xlsx"
wb = openpyxl.load_workbook(LOCAL_EXCEL, data_only=True)
ws_resumo = wb['RESUMO']

vals = [str(ws_resumo.cell(row=1, column=c).value) for c in range(1, 10)]
print("Headers: " + " | ".join(vals))
