# Pi's managed installer keeps its launcher under ~/.pi/agent/bin and doesn't
# touch shell rc files. Own it on PATH directly now that mise no longer
# manages pi.
export PATH="$HOME/.pi/agent/bin:$PATH"
