function mergeLegacyTags(state, library) {
  let changed = false;
  for (const record of library.records) {
    const id = record.id;
    const incoming = JSON.stringify(record);
    const current = state.records[id];
    if (current && (state.legacyBaseline[id] !== JSON.stringify(current) || incoming === state.legacyBaseline[id])) continue;
    if (!current && state.legacyBaseline[id]) continue; // A local removal takes precedence.
    state.records[id] = record;
    state.legacyBaseline[id] = incoming;
    if (!record.excluded && !state.tracks[id]) {
      state.tracks[id] = {id,file:record.file,displayName:record.file,kind:record.kind,kindSource:"manual",
        duration:record.duration,fmt:"",size:0};
    }
    if (state.tracks[id] && !record.excluded) {
      state.tracks[id].kind = record.kind;
      state.tracks[id].kindSource = "manual";
    }
    if (record.excluded) {
      delete state.tracks[id];
      if (state.current===id) state.current=null;
    }
    changed = true;
  }
  for (const group of library.groups) {
    const previous = state.legacyGroups[group.name] || [];
    const additions = group.tags.filter(tag=>!previous.includes(tag));
    const current = state.groups.find(item=>item.name===group.name);
    if (!current && (!Object.hasOwn(state.legacyGroups,group.name) || additions.length)) {
      state.groups.push({name:group.name,tags:[...additions]});
      changed = true;
    } else if (current) {
      const missing = additions.filter(tag=>!current.tags.includes(tag));
      if (missing.length) { current.tags.push(...missing); changed=true; }
    }
    state.legacyGroups[group.name] = [...new Set([...previous,...group.tags])];
  }
  return changed;
}

if (typeof module !== "undefined") module.exports = {mergeLegacyTags};
