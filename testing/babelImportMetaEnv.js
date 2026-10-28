// Jest executes CommonJS; model Vite's build-time environment in actual TS service tests.
module.exports = ({ types: t }) => ({
  visitor: {
    MemberExpression(path) {
      const node = path.node;
      if (t.isMetaProperty(node.object) && node.object.meta.name === 'import' &&
          node.object.property.name === 'meta' && t.isIdentifier(node.property, { name: 'env' })) {
        path.replaceWith(t.memberExpression(t.identifier('process'), t.identifier('env')));
      }
    },
  },
});
