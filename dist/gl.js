export function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error("shader: " + gl.getShaderInfoLog(sh) + "\n" + src);
    }
    return sh;
}
export function createProgram(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error("link: " + gl.getProgramInfoLog(p));
    }
    return p;
}
export function uniformMap(gl, prog) {
    const map = new Map();
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        map.set(info.name.replace(/\[0\]$/, ""), gl.getUniformLocation(prog, info.name));
    }
    return map;
}
export function createMesh(gl, vertices, attrs, indices, mode, instances = 0) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    for (const a of attrs) {
        gl.enableVertexAttribArray(a.loc);
        gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, a.stride * 4, a.offset * 4);
        if (a.divisor)
            gl.vertexAttribDivisor(a.loc, a.divisor);
    }
    let count = vertices.length;
    let indexed = false;
    if (indices) {
        const ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        count = indices.length;
        indexed = true;
    }
    gl.bindVertexArray(null);
    return { vao, count, mode, indexed, instances: instances || undefined };
}
export function drawMesh(gl, m) {
    gl.bindVertexArray(m.vao);
    if (m.indexed) {
        if (m.instances)
            gl.drawElementsInstanced(m.mode, m.count, gl.UNSIGNED_INT, 0, m.instances);
        else
            gl.drawElements(m.mode, m.count, gl.UNSIGNED_INT, 0);
    }
    else {
        if (m.instances)
            gl.drawArraysInstanced(m.mode, 0, m.count, m.instances);
        else
            gl.drawArrays(m.mode, 0, m.count);
    }
    gl.bindVertexArray(null);
}
//# sourceMappingURL=gl.js.map