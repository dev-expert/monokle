import path from 'path';
import {FileMapType, ResourceMapType} from '@models/appstate';
import {FileEntry} from '@models/fileentry';
import {K8sResource, ResourceRefType} from '@models/k8sresource';
import {getResourcesForPath} from '@redux/services/fileEntry';
import log from 'loglevel';
import {createFileRef, getK8sResources, getScalarNodes, linkResources, NodeWrapper} from './resource';

/**
 * Creates kustomization refs between a kustomization and its resources
 */

function linkParentKustomization(
  fileEntry: FileEntry,
  kustomization: K8sResource,
  resourceMap: ResourceMapType,
  refNode: NodeWrapper
) {
  let result: K8sResource[] = [];

  getResourcesForPath(fileEntry.filePath, resourceMap).forEach(r => {
    // since the target is a file there is no target refNode
    linkResources(kustomization, r, refNode);
    result.push(r);
  });

  return result;
}

/**
 * Checks if the specified resource is a kustomization resource
 */

export function isKustomizationResource(r: K8sResource | undefined) {
  return r && r.kind === 'Kustomization';
}

/**
 * Checks if the specified fileEntry is a kustomization file
 */

export function isKustomizationFile(fileEntry: FileEntry, resourceMap: ResourceMapType) {
  if (fileEntry.name.toLowerCase() === 'kustomization.yaml') {
    const resources = getResourcesForPath(fileEntry.filePath, resourceMap);
    return resources.length === 1 && isKustomizationResource(resources[0]);
  }

  return false;
}

/**
 * Processes a resource ref in a kustomization and creates corresponding resourcerefs
 */

function processKustomizationResource(
  kustomization: K8sResource,
  refNode: NodeWrapper,
  resourceMap: ResourceMapType,
  fileMap: FileMapType
) {
  let kpath = path.join(path.parse(kustomization.filePath).dir, refNode.nodeValue());
  const fileEntry = fileMap[kpath];
  if (fileEntry) {
    if (fileEntry.children) {
      // resource is folder -> find contained kustomizations and link...
      fileEntry.children
        .map(child => fileMap[path.join(fileEntry.filePath, child)])
        .filter(childFileEntry => childFileEntry)
        .filter(childFileEntry => isKustomizationFile(childFileEntry, resourceMap))
        .forEach(childFileEntry => {
          linkParentKustomization(childFileEntry, kustomization, resourceMap, refNode);
        });
    } else {
      // resource is file -> check for contained resources
      linkParentKustomization(fileEntry, kustomization, resourceMap, refNode);
    }
  }
}

/**
 * Extract patches at the specified nodePath and create resource or file refs
 */

function extractPatches(
  kustomization: K8sResource,
  fileMap: FileMapType,
  resourceMap: ResourceMapType,
  patchPath: string
) {
  let strategicMergePatches = getScalarNodes(kustomization, patchPath);
  strategicMergePatches.forEach((refNode: NodeWrapper) => {
    let kpath = path.join(path.parse(kustomization.filePath).dir, refNode.nodeValue());
    const fileEntry = fileMap[kpath];
    if (fileEntry) {
      let linkedResources = linkParentKustomization(fileEntry, kustomization, resourceMap, refNode);
      if (linkedResources.length > 0) {
        linkedResources.forEach(resource => {
          if (!resource.name.startsWith('Patch:')) {
            resource.name = `Patch: ${resource.name}`;
          }
        });
      } else {
        log.warn(`No resources in ${refNode.nodeValue()} - creating FileRef to ${kpath}`);
        createFileRef(kustomization, refNode, kpath);
      }
    } else {
      log.warn(`Failed to find ${patchPath} ${refNode.nodeValue()} in ${kustomization.filePath}`);
    }
  });
}

/**
 * Processes all kustomizations in resourceMap and establishes corresponding resourcerefs
 */

export function processKustomizations(resourceMap: ResourceMapType, fileMap: FileMapType) {
  getK8sResources(resourceMap, 'Kustomization')
    .filter(k => k.content.resources || k.content.bases || k.content.patchesStrategicMerge)
    .forEach(kustomization => {
      let resources = getScalarNodes(kustomization, 'resources') || [];
      if (kustomization.content.bases) {
        resources = resources.concat(getScalarNodes(kustomization, 'bases'));
      }

      resources.forEach((refNode: NodeWrapper) => {
        processKustomizationResource(kustomization, refNode, resourceMap, fileMap);
      });

      extractPatches(kustomization, fileMap, resourceMap, 'patchesStrategicMerge');
      extractPatches(kustomization, fileMap, resourceMap, 'patchesJson6902:path');
    });
}

/**
 * Gets all resources directly linked to by a kustomization, including transient resources
 */

export function getKustomizationRefs(
  resourceMap: ResourceMapType,
  kustomizationId: string,
  selectParent: boolean = false
) {
  let linkedResourceIds: string[] = [];
  const kustomization = resourceMap[kustomizationId];
  if (kustomization && kustomization.refs) {
    kustomization.refs
      .filter(r => r.type === ResourceRefType.Outgoing || (selectParent && r.type === ResourceRefType.Incoming))
      .forEach(r => {
        if (r.target?.type === 'resource' && r.target.resourceId) {
          const target = resourceMap[r.target.resourceId];
          if (target) {
            linkedResourceIds.push(r.target.resourceId);

            if (target.kind === 'Kustomization' && r.type === ResourceRefType.Outgoing) {
              linkedResourceIds = linkedResourceIds.concat(getKustomizationRefs(resourceMap, r.target.resourceId));
            }
          }
        }
      });
  }

  return linkedResourceIds;
}
