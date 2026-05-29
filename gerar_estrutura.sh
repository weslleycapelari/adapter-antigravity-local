#!/bin/bash

# =========================================
# Parâmetros de entrada com valores padrão
# =========================================
TARGET_DIR="${1:-./}"
OUTPUT_FILE="${2:-structure.md}"

# =========================================
# Diretórios e arquivos para ignorar
# =========================================
EXCLUDE=(".git" "node_modules" "vendor" "dist" "build" "out" "bin" "obj" "gerar_estrutura.sh")

# =========================================
# Função auxiliar para checar exclusão (Árvore)
# =========================================
is_excluded() {
    local target="$1"
    for dir in "${EXCLUDE[@]}"; do
        if [[ "$target" == "$dir" ]]; then
            return 0 # Encontrou (Verdadeiro, deve ser excluído)
        fi
    done
    return 1 # Não encontrou (Falso)
}

# =========================================
# Resolve caminho
# =========================================
if [[ ! -d "$TARGET_DIR" ]]; then
    echo "Erro: O diretório '$TARGET_DIR' não foi encontrado."
    exit 1
fi

ROOT_PATH=$(realpath "$TARGET_DIR")

# =========================================
# Mapeamento de extensões -> linguagem markdown
# =========================================
declare -A EXT_MAP=(
    [".ps1"]="powershell" [".js"]="javascript" [".ts"]="typescript"
    [".jsx"]="jsx"        [".tsx"]="tsx"       [".json"]="json"
    [".html"]="html"      [".css"]="css"       [".scss"]="scss"
    [".sass"]="sass"      [".php"]="php"       [".py"]="python"
    [".java"]="java"      [".cs"]="csharp"     [".cpp"]="cpp"
    [".c"]="c"            [".h"]="c"           [".go"]="go"
    [".rs"]="rust"        [".rb"]="ruby"       [".kt"]="kotlin"
    [".swift"]="swift"    [".sql"]="sql"       [".xml"]="xml"
    [".yml"]="yaml"       [".yaml"]="yaml"     [".md"]="markdown"
    [".sh"]="bash"        [".bat"]="bat"       [".cmd"]="bat"
    [".env"]="env"        [".txt"]="text"
)

# =========================================
# Detecta linguagem markdown
# =========================================
get_markdown_language() {
    local ext="${1,,}"
    local lang="${EXT_MAP[$ext]}"
    
    if [[ -n "$lang" ]]; then
        echo "$lang"
    else
        echo "text"
    fi
}

# =========================================
# Monta árvore visual
# =========================================
build_tree() {
    local current_path="$1"
    local prefix="$2"
    
    local dirs=()
    local files=()

    while IFS= read -r item; do
        [[ -z "$item" ]] && continue
        
        # Ignora o item se ele estiver no array de exclusão
        if is_excluded "$item"; then
            continue
        fi

        if [[ -d "$current_path/$item" ]]; then
            dirs+=("$item")
        else
            files+=("$item")
        fi
    done < <(ls -1 "$current_path" 2>/dev/null)

    local items=("${dirs[@]}" "${files[@]}")
    local total="${#items[@]}"
    
    local i # CORREÇÃO: Declarar 'i' como local para evitar vazamento de escopo na recursão

    for (( i=0; i<total; i++ )); do
        local item="${items[$i]}"
        local is_last=false
        [[ $i -eq $((total - 1)) ]] && is_last=true

        local connector="├── "
        $is_last && connector="└── "

        echo "${prefix}${connector}${item}"

        if [[ -d "$current_path/$item" ]]; then
            local new_prefix="${prefix}│   "
            $is_last && new_prefix="${prefix}    "
            build_tree "$current_path/$item" "$new_prefix"
        fi
    done
}

# Inicializa ou limpa o arquivo de saída
> "$OUTPUT_FILE"

# =========================================
# Gera árvore e cabeçalho markdown
# =========================================
{
    echo "# Project Structure"
    echo ""
    echo '````plaintext'
    echo "$ROOT_PATH"
    build_tree "$TARGET_DIR" ""
    echo '````'
} >> "$OUTPUT_FILE"

# =========================================
# Prepara argumentos do comando Find
# =========================================
# Monta o comando de exclusão (prune) para o find de forma dinâmica
FIND_EXCLUDES=()
for item in "${EXCLUDE[@]}"; do
    # CORREÇÃO: Removido o '-type d' para ignorar tanto arquivos quanto pastas
    FIND_EXCLUDES+=("-name" "$item" "-prune" "-o")
done

# =========================================
# Exporta conteúdo dos arquivos
# =========================================
while IFS= read -r -d '' file; do
    
    ABS_FILE=$(realpath "$file")
    ABS_OUT=$(realpath "$OUTPUT_FILE" 2>/dev/null)

    if [[ "$ABS_FILE" == "$ABS_OUT" ]]; then
        continue
    fi

    REL_PATH="${file#$TARGET_DIR/}"
    REL_PATH="${REL_PATH#/}"

    EXT=""
    filename=$(basename "$file")
    if [[ "$filename" == *.* ]]; then
        EXT=".${filename##*.}"
    fi

    LANG=$(get_markdown_language "$EXT")

    echo -e "\n---" >> "$OUTPUT_FILE"
    echo -e "\n## $REL_PATH\n" >> "$OUTPUT_FILE"

    if [[ -r "$file" ]]; then
        echo '````'"$LANG" >> "$OUTPUT_FILE"
        sed 's/````/`````/g' "$file" >> "$OUTPUT_FILE"
        echo -e "\n\`\`\`\`\n" >> "$OUTPUT_FILE" # CORREÇÃO: Fechamento com 4 crases
    else
        echo "_File reading error: Permission denied or unreadable file._" >> "$OUTPUT_FILE"
    fi

done < <(find "$TARGET_DIR" "${FIND_EXCLUDES[@]}" -type f -print0 | sort -z)

# =========================================
# Finalização
# =========================================
echo ""
echo "Markdown generated successfully:"
echo "$OUTPUT_FILE"
echo ""