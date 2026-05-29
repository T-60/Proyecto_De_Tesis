import json
import glob
from pathlib import Path

def generar_reporte():
    directorio = Path('data/03_pre_verified')
    archivos = list(directorio.glob('*.json'))
    archivos.sort()
    
    if not archivos:
        print("No hay archivos procesados en data/03_pre_verified/")
        return
        
    total_vars = 0
    total_verificados = 0
    total_id_corregido = 0
    total_requiere_llm = 0
    
    print("\n" + "="*80)
    print(f"{'ARCHIVO':<20} | {'TOTAL':<6} | {'VERIFICADOS':<12} | {'IDs CORREGIDOS':<15} | {'REQUIEREN LLM':<15}")
    print("-" * 80)
    
    for archivo in archivos:
        with open(archivo, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        variables = data.get("momento", {}).get("variables", [])
        v_verificado = 0
        v_id_corregido = 0
        v_requiere_llm = 0
        
        for var in variables:
            estado = var.get("estado_verificacion")
            if estado == "verificado": v_verificado += 1
            elif estado == "id_corregido": v_id_corregido += 1
            elif estado == "requiere_verificacion_llm": v_requiere_llm += 1
            
        # Sumar a totales
        total_vars += len(variables)
        total_verificados += v_verificado
        total_id_corregido += v_id_corregido
        total_requiere_llm += v_requiere_llm
        
        print(f"{archivo.name:<20} | {len(variables):<6} | {v_verificado:<12} | {v_id_corregido:<15} | {v_requiere_llm:<15}")
        
    print("=" * 80)
    print(" RESUMEN GLOBAL DEL PIPELINE")
    print("=" * 80)
    print(f"Total de documentos procesados : {len(archivos)}")
    print(f"Total de variables analizadas  : {total_vars}")
    print("-" * 50)
    
    # Calcular porcentajes
    exito_local = total_verificados + total_id_corregido
    pct_exito = (exito_local / total_vars * 100) if total_vars > 0 else 0
    pct_llm = (total_requiere_llm / total_vars * 100) if total_vars > 0 else 0
    
    print(f"[✓] Verificadas localmente (Costo $0.00) : {exito_local} variables ({pct_exito:.1f}%)")
    print(f"    - Nivel 1 (Coincidencia exacta)      : {total_verificados}")
    print(f"    - Nivel 2 (ID Corregido)             : {total_id_corregido}")
    print(f"[!] Requieren IA (Nivel 3 pendiente)     : {total_requiere_llm} variables ({pct_llm:.1f}%)")
    print("=" * 80 + "\n")

if __name__ == '__main__':
    generar_reporte()
