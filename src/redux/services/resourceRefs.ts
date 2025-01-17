import {ResourceMapType} from '@models/appstate';
import {K8sResource, RefNode, RefPosition, ResourceRef, ResourceRefType} from '@models/k8sresource';
import {REF_PATH_SEPARATOR} from '@constants/constants';
import {getIncomingRefMappers, getResourceKindHandler} from '@src/kindhandlers';
import {RefMapper} from '@models/resourcekindhandler';
import {isKustomizationResource} from '@redux/services/kustomize';
import {traverseDocument} from './manifest-utils';
import {createResourceRef, getParsedDoc, linkResources, NodeWrapper} from './resource';

export function isIncomingRef(refType: ResourceRefType) {
  return refType === ResourceRefType.Incoming;
}

export function isOutgoingRef(refType: ResourceRefType) {
  return refType === ResourceRefType.Outgoing;
}

export function isUnsatisfiedRef(refType: ResourceRefType) {
  return refType === ResourceRefType.Unsatisfied;
}

export function hasIncomingRefs(resource: K8sResource) {
  return resource.refs?.some(e => isIncomingRef(e.type));
}

export function isFileRef(ref: ResourceRef) {
  return ref.target?.type === 'file';
}

export function isResourceRef(ref: ResourceRef) {
  return ref.target?.type === 'resource';
}

export function isResourceRefTo(ref: ResourceRef, resourceId: string) {
  return ref.target?.type === 'resource' && ref.target.resourceId === resourceId;
}

export function hasOutgoingRefs(resource: K8sResource) {
  return resource.refs?.some(e => isOutgoingRef(e.type));
}

export function hasRefs(resource: K8sResource) {
  return resource.refs?.some(e => isOutgoingRef(e.type));
}

export function hasUnsatisfiedRefs(resource: K8sResource) {
  return resource.refs?.some(e => isUnsatisfiedRef(e.type));
}

const joinPathParts = (pathParts: string[]) => {
  return pathParts.join(REF_PATH_SEPARATOR);
};

export function processResourceRefNodes(resource: K8sResource) {
  const parsedDoc = getParsedDoc(resource);

  const resourceKindHandler = getResourceKindHandler(resource.kind);
  if (!resourceKindHandler) {
    return;
  }
  const outgoingRefMappers = resourceKindHandler?.outgoingRefMappers || [];
  const incomingRefMappers = getIncomingRefMappers(resource.kind);

  const refMappers = [...incomingRefMappers, ...outgoingRefMappers];

  if (!refMappers || refMappers.length === 0) {
    return;
  }

  traverseDocument(parsedDoc, (parentKeyPathParts, keyPathParts, key, scalar) => {
    refMappers.forEach(refMapper => {
      if (!resource.refNodeByPath) {
        resource.refNodeByPath = {};
      }

      const keyPath = joinPathParts(keyPathParts);
      const parentKeyPath = joinPathParts(parentKeyPathParts);

      const refMapperSourcePath = joinPathParts(refMapper.source.pathParts);
      const refMapperTargetPath = joinPathParts(refMapper.target.pathParts);

      if (refMapper.matchPairs) {
        if (refMapperSourcePath === parentKeyPath || refMapperTargetPath === parentKeyPath) {
          resource.refNodeByPath[keyPath] = {scalar, key, parentKeyPath};
        }
      } else {
        if (keyPath.endsWith(refMapperSourcePath)) {
          resource.refNodeByPath[refMapperSourcePath] = {scalar, key, parentKeyPath};
        }

        if (keyPath.endsWith(refMapperTargetPath)) {
          resource.refNodeByPath[refMapperTargetPath] = {scalar, key, parentKeyPath};
        }
      }
    });
  });
}

function cleanResourceRefs(resources: K8sResource[]) {
  resources.forEach(resource => {
    const cleanRefs: ResourceRef[] = [];

    const findSatisfiedRefOnPosition = (refPos: RefPosition) => {
      return resource.refs?.find(
        ref =>
          !isUnsatisfiedRef(ref.type) && ref.position?.column === refPos.column && ref.position.line === refPos.line
      );
    };

    resource.refs?.forEach(ref => {
      let shouldPush = true;

      if (isUnsatisfiedRef(ref.type)) {
        if (ref.position) {
          const foundSatisfiedRefOnSamePosition = findSatisfiedRefOnPosition(ref.position);
          if (foundSatisfiedRefOnSamePosition) {
            shouldPush = false;
          }
        }
      }

      if (shouldPush) {
        cleanRefs.push(ref);
      }
    });

    resource.refs = cleanRefs.length > 0 ? cleanRefs : undefined;
  });
}

function handleRefMappingByParentKey(
  sourceResource: K8sResource,
  targetResources: K8sResource[],
  outgoingRefMapper: RefMapper
) {
  const sourceRefNodes: RefNode[] = [];
  if (!sourceResource.refNodeByPath) {
    return;
  }

  Object.values(sourceResource.refNodeByPath).forEach(({scalar, key, parentKeyPath}) => {
    const outgoingRefMapperSourcePath = joinPathParts(outgoingRefMapper.source.pathParts);
    if (outgoingRefMapperSourcePath === parentKeyPath) {
      sourceRefNodes.push({scalar, key, parentKeyPath});
    }
  });

  // if no target resources are found, then mark all source ref nodes as unsatisfied
  if (targetResources.length === 0) {
    sourceRefNodes.forEach(sourceRefNode => {
      createResourceRef(
        sourceResource,
        ResourceRefType.Unsatisfied,
        new NodeWrapper(sourceRefNode.scalar, sourceResource.lineCounter),
        undefined,
        outgoingRefMapper.target.kind
      );
    });
  } else {
    sourceRefNodes.forEach(sourceRefNode => {
      const foundMatchByTargetResourceId: Record<string, boolean> = Object.fromEntries(
        targetResources.map(targetResource => [targetResource.id, false])
      );

      targetResources.forEach(targetResource => {
        const targetNodes: RefNode[] = [];
        if (!targetResource.refNodeByPath) {
          return;
        }
        Object.values(targetResource.refNodeByPath).forEach(({scalar, key, parentKeyPath}) => {
          const outgoingRefMapperTargetPath = joinPathParts(outgoingRefMapper.target.pathParts);
          if (outgoingRefMapperTargetPath === parentKeyPath) {
            targetNodes.push({scalar, key, parentKeyPath});
          }
        });
        targetNodes.forEach(targetNode => {
          if (sourceRefNode.key === targetNode.key && sourceRefNode.scalar.value === targetNode.scalar.value) {
            foundMatchByTargetResourceId[targetResource.id] = true;
            linkResources(
              sourceResource,
              targetResource,
              new NodeWrapper(sourceRefNode.scalar, sourceResource.lineCounter),
              new NodeWrapper(targetNode.scalar, targetResource.lineCounter)
            );
          }
        });
      });

      // if this sourceRefNode did not link to any target resource, mark the node as unsatisfied
      if (Object.values(foundMatchByTargetResourceId).every(foundMatch => foundMatch === false)) {
        createResourceRef(
          sourceResource,
          ResourceRefType.Unsatisfied,
          new NodeWrapper(sourceRefNode.scalar, sourceResource.lineCounter),
          undefined,
          outgoingRefMapper.target.kind
        );
      }
    });
  }
}

function handleRefMappingByKey(
  sourceResource: K8sResource,
  targetResources: K8sResource[],
  outgoingRefMapper: RefMapper
) {
  const outgoingRefMapperSourcePath = joinPathParts(outgoingRefMapper.source.pathParts);
  const sourceRefNode = sourceResource.refNodeByPath
    ? sourceResource.refNodeByPath[outgoingRefMapperSourcePath]
    : undefined;

  if (!sourceRefNode) {
    return;
  }

  // if no target resources are found, then mark the source ref as unsatisfied
  if (targetResources.length === 0) {
    createResourceRef(
      sourceResource,
      ResourceRefType.Unsatisfied,
      new NodeWrapper(sourceRefNode.scalar, sourceResource.lineCounter),
      undefined,
      outgoingRefMapper.target.kind
    );
  } else {
    let hasSatisfiedRefs = false;

    targetResources.forEach(targetResource => {
      const outgoingRefMapperTargetPath = joinPathParts(outgoingRefMapper.target.pathParts);
      const targetNode = targetResource.refNodeByPath
        ? targetResource.refNodeByPath[outgoingRefMapperTargetPath]
        : undefined;

      if (targetNode && sourceRefNode.scalar.value === targetNode.scalar.value) {
        hasSatisfiedRefs = true;
        linkResources(
          sourceResource,
          targetResource,
          new NodeWrapper(sourceRefNode.scalar, sourceResource.lineCounter),
          new NodeWrapper(targetNode.scalar, targetResource.lineCounter)
        );
      }
    });

    if (!hasSatisfiedRefs) {
      createResourceRef(
        sourceResource,
        ResourceRefType.Unsatisfied,
        new NodeWrapper(sourceRefNode.scalar, sourceResource.lineCounter),
        undefined,
        outgoingRefMapper.target.kind
      );
    }
  }
}

/*
  removes all outgoing refs on the specified resource and
  removes all incoming refs from the specified resource on all the other resources
*/
function clearResourceRefs(resource: K8sResource, resourceMap: ResourceMapType) {
  resource.refs = resource.refs?.filter(ref => ref.type === 'incoming');
  Object.values(resourceMap).forEach(currentResource => {
    currentResource.refs = currentResource.refs?.filter(ref => {
      if (ref.type === 'incoming' && isResourceRefTo(ref, resource.id)) {
        return false;
      }
      return true;
    });
  });
}

export function processRefs(resourceMap: ResourceMapType, filter?: {resourceIds?: string[]; resourceKinds?: string[]}) {
  const resources = Object.values(resourceMap).filter(resource => !isKustomizationResource(resource));
  resources.forEach(resource => processResourceRefNodes(resource));

  let filteredResources =
    filter && filter.resourceKinds
      ? resources.filter(resource =>
          filter.resourceKinds && filter.resourceKinds.length > 0 ? filter.resourceKinds.includes(resource.kind) : true
        )
      : resources;

  filteredResources.forEach(sourceResource => {
    clearResourceRefs(sourceResource, resourceMap);

    const resourceKindHandler = getResourceKindHandler(sourceResource.kind);
    if (
      !resourceKindHandler ||
      !resourceKindHandler.outgoingRefMappers ||
      resourceKindHandler.outgoingRefMappers.length === 0
    ) {
      return;
    }
    resourceKindHandler.outgoingRefMappers.forEach(outgoingRefMapper => {
      const targetResources = Object.values(resourceMap).filter(
        targetResource => targetResource.kind === outgoingRefMapper.target.kind
      );

      if (outgoingRefMapper.matchPairs) {
        handleRefMappingByParentKey(sourceResource, targetResources, outgoingRefMapper);
      } else {
        handleRefMappingByKey(sourceResource, targetResources, outgoingRefMapper);
      }
    });
  });

  cleanResourceRefs(filteredResources);
}
